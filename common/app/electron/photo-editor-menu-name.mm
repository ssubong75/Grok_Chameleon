#import <Cocoa/Cocoa.h>
#import <objc/message.h>
#import <objc/runtime.h>
#include <dlfcn.h>
#include <node_api.h>
#include <string>

static napi_env callbackEnv = nullptr;
static napi_ref saveCallback = nullptr;
static NSMenuItem *saveItem = nil;
static NSString *editorMenuTitle = nil;
static id menuObserver = nil;
static NSString *(*originalObjectForInfoDictionaryKey)(id, SEL, NSString *) = nullptr;
static NSDictionary *(*originalLocalizedInfoDictionary)(id, SEL) = nullptr;
static NSDictionary *(*originalInfoDictionary)(id, SEL) = nullptr;
static NSString *(*originalLocalizedName)(id, SEL) = nullptr;
static dispatch_source_t menuTitleTimer = nil;
static NSString *ForcedObjectForInfoDictionaryKey(id self, SEL cmd, NSString *key) {
  if (self == [NSBundle mainBundle] && editorMenuTitle && ([key isEqualToString:@"CFBundleName"] || [key isEqualToString:@"CFBundleDisplayName"])) return editorMenuTitle;
  return originalObjectForInfoDictionaryKey(self, cmd, key);
}
static NSDictionary *ForcedInfo(id self, SEL cmd, NSDictionary *(*original)(id, SEL)) {
  NSDictionary *info = original(self, cmd);
  if (self != [NSBundle mainBundle] || !editorMenuTitle) return info;
  NSMutableDictionary *copy = [info mutableCopy] ?: [NSMutableDictionary dictionary];
  copy[@"CFBundleName"] = editorMenuTitle;
  copy[@"CFBundleDisplayName"] = editorMenuTitle;
  return copy;
}
static NSDictionary *ForcedInfoDictionary(id self, SEL cmd) { return ForcedInfo(self, cmd, originalInfoDictionary); }
static NSDictionary *ForcedLocalizedInfoDictionary(id self, SEL cmd) { return ForcedInfo(self, cmd, originalLocalizedInfoDictionary); }
static NSString *ForcedLocalizedName(id self, SEL cmd) {
  if (editorMenuTitle && [self isKindOfClass:[NSRunningApplication class]] && [(NSRunningApplication *)self isEqual:[NSRunningApplication currentApplication]]) return editorMenuTitle;
  return originalLocalizedName(self, cmd);
}
static void InstallNameOverride() {
  if (originalObjectForInfoDictionaryKey) return;
  Method key = class_getInstanceMethod([NSBundle class], @selector(objectForInfoDictionaryKey:));
  originalObjectForInfoDictionaryKey = (NSString *(*)(id, SEL, NSString *))method_setImplementation(key, (IMP)ForcedObjectForInfoDictionaryKey);
  Method info = class_getInstanceMethod([NSBundle class], @selector(infoDictionary));
  originalInfoDictionary = (NSDictionary *(*)(id, SEL))method_setImplementation(info, (IMP)ForcedInfoDictionary);
  Method localized = class_getInstanceMethod([NSBundle class], @selector(localizedInfoDictionary));
  originalLocalizedInfoDictionary = (NSDictionary *(*)(id, SEL))method_setImplementation(localized, (IMP)ForcedLocalizedInfoDictionary);
  Class runningClass = object_getClass([NSRunningApplication currentApplication]) ?: [NSRunningApplication class];
  Method name = class_getInstanceMethod(runningClass, @selector(localizedName));
  originalLocalizedName = (NSString *(*)(id, SEL))method_setImplementation(name, (IMP)ForcedLocalizedName);
}
static NSString *SetSystemDisplayName(NSString *name) {
  typedef OSStatus (*SetInformation)(int, CFTypeRef, CFStringRef, CFStringRef, CFDictionaryRef *);
  typedef CFTypeRef (*GetASN)(void);
  static SetInformation setItem = NULL;
  static GetASN getASN = NULL;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    void *ls = dlopen("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/LaunchServices", RTLD_LAZY);
    if (!ls) ls = dlopen("/System/Library/Frameworks/CoreServices.framework/CoreServices", RTLD_LAZY);
    if (ls) {
      setItem = (SetInformation)dlsym(ls, "_LSSetApplicationInformationItem");
      getASN = (GetASN)dlsym(ls, "_LSGetCurrentApplicationASN");
    }
  });
  if (!setItem || !getASN || !name) return @"missing";
  CFTypeRef asn = getASN();
  if (!asn) return @"no-asn";
  OSStatus bundle = setItem(-2, asn, CFSTR("CFBundleName"), (__bridge CFStringRef)name, NULL);
  OSStatus display = setItem(-2, asn, CFSTR("LSDisplayName"), (__bridge CFStringRef)name, NULL);
  OSStatus shown = setItem(-2, asn, CFSTR("CFBundleDisplayName"), (__bridge CFStringRef)name, NULL);
  return [NSString stringWithFormat:@"bundle=%d display=%d shown=%d", bundle, display, shown];
}
static void PlaceSaveAfterWindow() {
  if (!saveItem) return;
  NSMenu *bar = [[NSApplication sharedApplication] mainMenu];
  NSMenuItem *windowItem = nil;
  for (NSMenuItem *item in [bar itemArray]) {
    if ([[item title] isEqualToString:@"Window"] || [[item title] isEqualToString:@"창"]) { windowItem = item; break; }
  }
  if (!windowItem) return;
  NSInteger target = [bar indexOfItem:windowItem] + 1;
  if ([saveItem menu] == bar && [bar indexOfItem:saveItem] == target) return;
  [[saveItem menu] removeItem:saveItem];
  [bar insertItem:saveItem atIndex:[bar indexOfItem:windowItem] + 1];
}
static void ApplyMenuTitle() {
  NSMenu *bar = [[NSApplication sharedApplication] mainMenu];
  if (!editorMenuTitle || [bar numberOfItems] == 0) return;
  NSMenuItem *item = [bar itemAtIndex:0];
  for (NSMenuItem *candidate in [bar itemArray]) {
    NSString *label = [candidate title];
    NSString *drawn = [[candidate attributedTitle] string];
    if ([label isEqualToString:@"Grok Chameleon"] || [label isEqualToString:@"Photo Editor"] || [drawn isEqualToString:@"Grok Chameleon"] || [drawn isEqualToString:@"Photo Editor"]) {
      item = candidate;
      break;
    }
  }
  [item setTitle:editorMenuTitle];
  [[item submenu] setTitle:editorMenuTitle];
  // AppKit uses an attributed title when drawing the application menu.
  [item setAttributedTitle:[[NSAttributedString alloc] initWithString:editorMenuTitle]];
  if ([item respondsToSelector:@selector(setAccessibilityLabel:)]) [item setAccessibilityLabel:editorMenuTitle];
  SEL setApplicationName = NSSelectorFromString(@"_setApplicationName:");
  if ([NSApp respondsToSelector:setApplicationName]) ((void (*)(id, SEL, id))objc_msgSend)(NSApp, setApplicationName, editorMenuTitle);
  NSString *systemName = SetSystemDisplayName(editorMenuTitle);
  NSString *line = [NSString stringWithFormat:@"title=%@ localized=%@ class=%@ system=%@\n", [item title], [[NSRunningApplication currentApplication] localizedName], NSStringFromClass(object_getClass([NSRunningApplication currentApplication])), systemName];
  [line writeToFile:@"/tmp/chameleon-menu-live.txt" atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
@interface EditorSaveTarget : NSObject <NSMenuDelegate>
- (void)chameleonSaveToApp:(id)sender;
@end
@implementation EditorSaveTarget
- (void)menuWillOpen:(NSMenu *)menu {
  [menu cancelTrackingWithoutAnimation];
  if (![saveItem isEnabled]) return;
  dispatch_async(dispatch_get_main_queue(), ^{ [self chameleonSaveToApp:nil]; });
}
- (void)chameleonSaveToApp:(id)sender {
  if (!callbackEnv || !saveCallback) return;
  napi_handle_scope scope;
  napi_open_handle_scope(callbackEnv, &scope);
  napi_value callback, receiver, result;
  napi_get_reference_value(callbackEnv, saveCallback, &callback);
  napi_get_undefined(callbackEnv, &receiver);
  napi_call_function(callbackEnv, receiver, callback, 0, nullptr, &result);
  napi_close_handle_scope(callbackEnv, scope);
}
@end
static EditorSaveTarget *saveTarget = nil;
static void ClearSave() {
  if (saveItem) { [[saveItem menu] removeItem:saveItem]; saveItem = nil; }
  if (saveCallback) { napi_delete_reference(callbackEnv, saveCallback); saveCallback = nullptr; }
  saveTarget = nil;
  callbackEnv = nullptr;
}
static napi_value ClearSaveAction(napi_env env, napi_callback_info info) {
  ClearSave();
  napi_value result; napi_get_undefined(env, &result); return result;
}
static napi_value SetSaveAction(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  bool enabled = false; napi_valuetype type;
  if (argc != 2 || napi_get_value_bool(env, args[0], &enabled) != napi_ok || napi_typeof(env, args[1], &type) != napi_ok || type != napi_function || ![NSThread isMainThread]) {
    napi_throw_type_error(env, nullptr, "Expected enabled state and a save callback on the main thread."); return nullptr;
  }
  ClearSave(); callbackEnv = env; napi_create_reference(env, args[1], 1, &saveCallback);
  saveTarget = [EditorSaveTarget new];
  saveItem = [[NSMenuItem alloc] initWithTitle:@"Save to App" action:@selector(chameleonSaveToApp:) keyEquivalent:@""];
  [saveItem setTarget:saveTarget]; [saveItem setEnabled:enabled];
  NSMenu *saveMenu = [[NSMenu alloc] initWithTitle:@"Save to App"];
  [saveMenu setAutoenablesItems:NO];
  [saveMenu setDelegate:saveTarget];
  NSMenuItem *saveCommand = [[NSMenuItem alloc] initWithTitle:@"Save to App" action:@selector(chameleonSaveToApp:) keyEquivalent:@""];
  [saveCommand setTarget:saveTarget];
  [saveCommand setEnabled:enabled];
  [saveMenu addItem:saveCommand];
  [saveItem setSubmenu:saveMenu];
  [saveItem setAttributedTitle:[[NSAttributedString alloc] initWithString:@"Save to App" attributes:@{NSForegroundColorAttributeName:[NSColor colorWithSRGBRed:251.0/255.0 green:173.0/255.0 blue:46.0/255.0 alpha:1]}]];
  NSMenu *bar = [[NSApplication sharedApplication] mainMenu];
  PlaceSaveAfterWindow();
  if ([saveItem menu] != bar) {
    napi_throw_error(env, nullptr, "Could not install Save to App in the application menu."); return nullptr;
  }
  napi_value result; napi_get_undefined(env, &result); return result;
}

// Electron rewrites the first menu's label on macOS. Apply the editor title
// after Menu.setApplicationMenu has installed its NSMenu.
static napi_value SetMenuTitle(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  size_t length = 0;
  if (argc != 1 || napi_get_value_string_utf8(env, args[0], nullptr, 0, &length) != napi_ok || length > 200) {
    napi_throw_type_error(env, nullptr, "Expected an application menu title.");
    return nullptr;
  }
  std::string text(length + 1, '\0');
  napi_get_value_string_utf8(env, args[0], text.data(), text.size(), &length);
  NSString *title = [[NSString alloc] initWithBytes:text.data() length:length encoding:NSUTF8StringEncoding];
  if (![NSThread isMainThread] || !title) {
    napi_throw_error(env, nullptr, "The application menu must be updated on the main thread.");
    return nullptr;
  }
  editorMenuTitle = title;
  [[NSProcessInfo processInfo] setProcessName:title];
  InstallNameOverride();
  NSMenu *currentMenu = [[NSApplication sharedApplication] mainMenu];
  if (currentMenu) {
    [[NSApplication sharedApplication] setMainMenu:nil];
    [[NSApplication sharedApplication] setMainMenu:currentMenu];
  }
  if (!menuTitleTimer) {
    menuTitleTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(menuTitleTimer, dispatch_time(DISPATCH_TIME_NOW, 0), (uint64_t)(0.3 * NSEC_PER_SEC), (uint64_t)(0.05 * NSEC_PER_SEC));
    dispatch_source_set_event_handler(menuTitleTimer, ^{
      ApplyMenuTitle();
      NSMenuItem *first = [[[NSApplication sharedApplication] mainMenu] itemAtIndex:0];
      NSString *line = [NSString stringWithFormat:@"title=%@ drawn=%@ localized=%@\n", [first title], [[first attributedTitle] string], [[NSRunningApplication currentApplication] localizedName]];
      [line writeToFile:@"/tmp/chameleon-menu-live.txt" atomically:YES encoding:NSUTF8StringEncoding error:nil];
    });
    dispatch_resume(menuTitleTimer);
  }
  NSMutableDictionary *bundleInfo = (NSMutableDictionary *)[[NSBundle mainBundle] infoDictionary];
  if ([bundleInfo isKindOfClass:[NSMutableDictionary class]]) {
    bundleInfo[@"CFBundleName"] = title;
    bundleInfo[@"CFBundleDisplayName"] = title;
  }
  NSMutableDictionary *localizedInfo = (NSMutableDictionary *)[[NSBundle mainBundle] localizedInfoDictionary];
  if ([localizedInfo isKindOfClass:[NSMutableDictionary class]]) {
    localizedInfo[@"CFBundleName"] = title;
    localizedInfo[@"CFBundleDisplayName"] = title;
  }
  NSMutableArray *beforeTitles = [NSMutableArray array];
  for (NSMenuItem *entry in [[[NSApplication sharedApplication] mainMenu] itemArray]) [beforeTitles addObject:@{ @"title": [entry title] ?: @"", @"submenu": [[entry submenu] title] ?: @"" }];
  ApplyMenuTitle();
  NSMutableArray *afterTitles = [NSMutableArray array];
  for (NSMenuItem *entry in [[[NSApplication sharedApplication] mainMenu] itemArray]) [afterTitles addObject:@{ @"title": [entry title] ?: @"", @"submenu": [[entry submenu] title] ?: @"" }];
  NSData *diagnostic = [NSJSONSerialization dataWithJSONObject:@{ @"requested": title, @"before": beforeTitles, @"after": afterTitles } options:NSJSONWritingPrettyPrinted error:nil];
  [diagnostic writeToFile:@"/tmp/chameleon-menu-title-diagnostic.json" atomically:YES];
  if (!menuObserver) menuObserver = [[NSNotificationCenter defaultCenter] addObserverForName:NSApplicationDidUpdateNotification object:nil queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification *notification) {
    NSMenu *bar = [[NSApplication sharedApplication] mainMenu];
    if (editorMenuTitle && [bar numberOfItems]) {
      NSMenuItem *first = [bar itemAtIndex:0];
      NSString *drawn = [[first attributedTitle] string] ?: [first title];
      if (![drawn isEqualToString:editorMenuTitle] || ![[first title] isEqualToString:editorMenuTitle]) ApplyMenuTitle();
    }
    PlaceSaveAfterWindow();
  }];
  NSMenu *bar = [[NSApplication sharedApplication] mainMenu];
  BOOL foundTitle = NO;
  for (NSMenuItem *item in [bar itemArray]) if ([[item title] isEqualToString:title]) foundTitle = YES;
  if (!foundTitle) {
    napi_throw_error(env, nullptr, "Could not set the application menu title."); return nullptr;
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value Initialize(napi_env env, napi_value exports) {
  napi_value function;
  napi_create_function(env, "setMenuTitle", NAPI_AUTO_LENGTH, SetMenuTitle, nullptr, &function);
  napi_set_named_property(env, exports, "setMenuTitle", function);
  napi_create_function(env, "setSaveAction", NAPI_AUTO_LENGTH, SetSaveAction, nullptr, &function);
  napi_set_named_property(env, exports, "setSaveAction", function);
  napi_create_function(env, "clearSaveAction", NAPI_AUTO_LENGTH, ClearSaveAction, nullptr, &function);
  napi_set_named_property(env, exports, "clearSaveAction", function);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
