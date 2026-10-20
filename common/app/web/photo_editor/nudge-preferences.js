// A bundle may continue only while document revision, undo state and target are unchanged.
export function createNudgeBundler(){let previous=null;return function nudge(document,dx,dy,prefs,now=performance.now()){
  const target=JSON.stringify([document.selectedLayerIds,document.activeId,document.active?.editMask,document.active?.maskLinked]);
  const top=document.undoStack.at(-1),pause=Number(prefs.nudgeBundlePauseMs);
  const join=Boolean(prefs.bundleNudges&&previous&&previous.document===document&&previous.target===target&&previous.revision===document.revision&&previous.top===top&&top&&now>=previous.time&&now-previous.time<=pause);
  previous=null;document.translateLayers(dx,dy,!join);
  previous={document,target,revision:document.revision,top:document.undoStack.at(-1),time:now};
};}
