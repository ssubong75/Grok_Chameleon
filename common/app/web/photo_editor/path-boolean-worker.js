import {combinePaths} from './path-boolean.js';
self.onmessage=event=>{try{const {paths,operation,tolerance}=event.data;self.postMessage({path:combinePaths(paths,operation,tolerance)});}catch(error){self.postMessage({error:error.message||String(error)});}};
