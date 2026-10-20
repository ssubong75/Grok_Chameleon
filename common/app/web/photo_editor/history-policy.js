// Original History States default; memory budget remains specific to JS undo snapshots.
export const historyPolicy={states:50,memoryMB:192};
export function setHistoryPolicy(states,memoryMB){if(!Number.isInteger(states)||states<1||states>1000||!Number.isInteger(memoryMB)||memoryMB<16||memoryMB>1048576)throw Error('Invalid history limit.');historyPolicy.states=states;historyPolicy.memoryMB=memoryMB;}
export function historyOverLimit(count,bytes){return count>1&&(count>historyPolicy.states||bytes>historyPolicy.memoryMB*1024*1024);}
