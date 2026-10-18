# Photo Editor JavaScript migration

Active request: preserve PhotoCraft appearance, fonts and functions as closely as possible; eliminate Rust/WASM. User requests continuous implementation and approximate progress after milestones. User explicitly deferred ALL further verification until feature implementation is complete. Do not run per-stage tests or reopen synthetic preview for now.

Implementation root: Resources/Grok Chameleon/resources/app/web/photo_editor
Existing electron/photo-editor-host.js still selects photo-editor-web (WASM). Do not switch the app until migration is ready for final integration.

Approximate implementation progress reported: 50%. This is an estimate of work, NOT a measured parity score or a validation result.

Implemented, with latest additions UNVERIFIED:
- Pure DOM/CSS/Canvas UI, upstream fonts and SVG icons, 90% / medium defaults, marquee default, Properties hidden. Save to App yellow text without a box.
- New/open/place/drop documents; multiple tabs; project raster/text/shape/adjustment/group/path/channel/effect/smart data; undo/redo; History panel; Navigator.
- Raster layers, opacity/blends, masks with direct editing, groups and clipping, layer styles (shadow/stroke/overlay).
- Brush/eraser hardness, clone stamp, marquee/ellipse/lasso/magic wand, selection set operations, morphology and feather alpha selections; selection pixel move; color range; foreground/background shortcuts.
- Pen and direct anchor editing, selection/path conversion, path fill/stroke/duplicate and SVG path export.
- Editable multiline text with font selection, system-font loading, alignment/tracking/leading/styles; editable geometric shapes.
- Image/canvas size, rotation/flip, crop preserving pixels optionally, trim, guides/grid, zoom/pan; numeric and interactive layer transforms.
- Pixel adjustments, curves graph, color balance, vibrance, adjustment layers. Filter workers support cancellable previews and execution without compiled runtime.
- Blur/sharpen/noise/pixelate/distort/stylize/other subset including extended filter options; smart objects retain source and filter/transform operations.
- PNG/JPEG/WebP exports, TIFF page import/orientation/export via UTIF, PSD raster/group/mask/clipping/resolution import/export via ag-psd, custom projects and export size/quality/transparency/selection controls.

Known major remaining work (not exhaustive):
- Complete enabled command/algorithm inventory from upstream (catalog contains disabled reference commands too).
- Camera Raw pipeline, remaining advanced filters, healing/remove/content-aware tools, smudge/dodge/burn/sponge, magnetic/quick selections, perspective/warp/liquify and advanced vector/type features.
- Full PSD editable text/vector/effects/smart data, 16/32-bit and color models/profiles; additional codecs and project compatibility with original PhotoCraft.
- Workspace docking/layout and original visual parity; complete keyboard/context menu behavior, brush presets/symmetry and advanced layer styles.
- Full final source/syntax/engine/UI validation with ONLY synthetic images, then host bridge integration and app switch. Last passing old engine run was 15/15 BEFORE the large additions in this session. No new checks have run since user deferred them.

Public upstream reference: initial UI/theme sources at 5c7c8479234da520d374381c7573eb9e7b55a76b; additional engine/algo sources downloaded from main during this session, main observed as 56dbc89a38248f6e50db50d132de47be88494cf6. Keep NOTICE and upstream licenses. Third-party vendored ag-psd, pako and UTIF licenses next to bundles. No user prompts/images/library were opened for implementation.

Recent modules: transforms.js, free-transform.js, selections.js, spatial-filters.js, layer-effects.js, type-renderer.js, shape-renderer.js, curves.js, brush-engine.js, gradient-renderer.js, filter-worker.js, filter-task.js, tiff.js.

Follow-up risks to resolve during implementation and final validation:
- Newly added group/smart/mask/alpha-selection interactions have not been exercised.
- Moving selected pixels currently retains source canvas bounds; larger-canvas destination handling still needs work.
- Group child moves need to carry smart-object source origins, group mask positions and inherited lock state consistently.
- Alpha selections require matching coverage in every remaining operation (path stroke, copy/export now connected; review other editing tools at final validation).
- Smart object rebuilding still runs synchronously when toggling filters, although normal filter dialogs use workers.
- Mask gradients currently do not interpolate the old mask by the gradient opacity setting.
- TIFF and advanced PSD behavior is not verified; Photoshop editable smart/text/vector data is not yet preserved.
- Avoid claiming full compatibility or switching host prematurely.

## Later continuation (same implementation run)
- Approximate implementation estimate now reported as 60%, still UNVERIFIED. No tests/checks were run.
- User explicitly asked: finish current stage, restart editor, then continue. Restarted isolated JavaScript preview (synthetic demo only), own PID 14560 / exec session 66398; previous PID9868 stopped after checking executable path. preview.cjs now opens demo directly; engine tests run ONLY if PHOTO_EDITOR_RUN_TESTS=1. Do not enable tests until all functionality is implemented as user instructed.
- Added grouped toolbar (right-click / hold / Shift shortcut cycling), Dodge/Burn/Sponge/Blur/Sharpen/Smudge/Pencil; brush flow/spacing/presets/pressure/symmetry; layer drag/context menu; revert snapshots and Close Others.
- Added real Healing Brush using a JavaScript port of the upstream cascadic membrane/SOR Poisson solver, running in retouch-worker.js; clone/healing now expose Current Layer / All Layers and Aligned sampling. Spot Healing/content-aware fill still missing.
- Added perspective.js / perspective-task.js / perspective-worker.js, numeric corner dialog with worker previews, smart perspective operation retention and translation helpers.
- Added deformations.js and liquify-ui.js: Forward Warp, Twirl, Pucker, Bloat, Freeze/Thaw, local Undo/Restore; Liquify runs through filter worker and smart filter stack. This UI/algorithm has not been tested or compared visually.
- Additional original reference files: engine-retouch.rs, paint-retouch.rs, paint-brush.rs, algo-retouch.rs, algo-poisson.rs.
- New next focus: Quick Mask and consistent channel editing, then remaining advanced functions.

## Progress correction
Upstream commands.rs registers 101 additional command modules. The previous 60% estimate over-weighted basic editing. User was explicitly informed that the estimate is corrected to approximately 30–40% of the original full functionality/appearance scope. Use this corrected baseline, not 60%. engine-module-inventory.json records modules for continued implementation planning, NOT validation.
Quick Mask/channel painting and filter routing were added but remain unverified. Perspective and Liquify also remain unverified. No stage tests were run.

## Continued implementation: October 19

- Latest communicated estimate: roughly 40–45% of full original scope, an estimate only, not a parity measurement. All additions below are UNVERIFIED; no syntax, runtime, visual or engine tests were run, per the user's sequencing instruction.
- Procedural Solid/Gradient/Pattern fill layers implemented with editable descriptors and smart operations. Gradient fill geometry now follows upstream centre/chord/ellipse formulas; brush-drag gradients keep their drag geometry.
- Added Polygonal/Magnetic Lasso grouped with Lasso, click fastening/automatic magnetic anchors, Enter/double-click/first-point finish, Backspace and Escape. Magnetic field reads 128px blocks and uses premultiplied-channel Sobel ridges, subpixel edge positions, corridor shortest paths and upstream link weights. Original simplification/full guide handling is not yet fully ported.
- Added Spot Healing (Content-Aware / Proximity Match), worker cancellation, automatic nearby source matching and Poisson boundary blending. Proximity source search follows upstream ring SSD/coarse/refined displacement search. Content-Aware uses the new multiscale PatchMatch module and weighted patch voting; original source transforms, colour adaptation, thin-hole optimisations and texture synthesis mode remain pending.
- Added Edit > Content-Aware Fill for selected layer pixels, with worker execution and smart-filter metadata. New content-aware.js is an implementation adaptation, NOT a claim of exact original output parity.
- Added Color to Alpha from upstream unmix/threshold logic; filter fields now support colour values. Added click-local Red Eye from upstream connected pupil mask, erosion, Gaussian feather and neutralising/darkening logic.
- Layer styles now include inner shadow, outer/inner glow, gradient/pattern overlays, Satin and Smooth Bevel/Emboss styles. surface-effects.js ports fractional box/tent height maps and lighting formulas. Advanced contours, chisel techniques, textures, noise, multiple effect instances and exact style compositing remain pending.
- Added Pen segment insertion by cubic subdivision, anchor deletion, path context menu with open/close/reverse/smooth/corner operations; path fill/stroke now target custom channels and masks as well as raster pixels.
- Selected-pixel move now expands the layer/mask canvas to retain pixels moved beyond its former bounds. Multi-layer raise/lower chooses the outer selected sibling boundary. Mask thumbnail selection resets active multi-selection. History includes previous selection and accounts for alpha selection/Quick Mask buffers.
- Project JSON converts typed array settings to arrays, including content-aware masks in smart filters.
- New explicit 2-hour wrap-up/GitHub/Desktop-handoff request is recorded in DEADLINE.md. Working root is not a Git checkout; publication checkout still needs to be established at wrap-up. Actual app host remains unchanged on WASM.

## 2026-10-19 — Text / Path / Selection milestone implementation (UNVERIFIED)
- Added editable paragraph/point text layout, alignment, spacing, vertical direction and affine placement.
- Added multi-anchor editing, linked/independent direction handles, curve bending and numeric path transforms. Cancel restores the pre-gesture history stacks.
- Connected Smooth / Grow / Similar / Refine Edge and selection-only transform; saved alpha channels can be loaded from Select menu.
- Refine Edge provides guided edge processing, preview modes and selection/mask/new layer/new document outputs, with cancellable workers.
- User explicitly instructed: do not verify. No new execution, syntax, visual or integration verification performed for this bundle.
- Actual application host remains on its existing editor. New JS editor remains standalone and incomplete. Full original parity and rich text/compound path capabilities are outstanding.
- Deadline is feature milestone, not clock time. Publication must include ZIPs and macOS on GitHub runner; user verification prohibition requires preserving unverified status and resolving mandatory workflow checks before claiming deployment complete.
