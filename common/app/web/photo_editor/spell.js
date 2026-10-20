let dictionary=null;
const userKey='chameleon.photoEditor.userDictionary';

function normalize(word){return word.replaceAll('\u2019',"'");}
function userWords(){try{const list=JSON.parse(localStorage.getItem(userKey)||'[]');return new Set(Array.isArray(list)?list.map(word=>String(word).toLowerCase()):[]);}catch{return new Set();}}
function saveUser(words){localStorage.setItem(userKey,JSON.stringify([...words]));}

export async function englishDictionary(){
  if(dictionary)return dictionary;
  const text=await fetch(new URL('./dict/en_US-scowl-50.txt',import.meta.url)).then(response=>{if(!response.ok)throw Error('The spelling dictionary did not load.');return response.text();});
  const words=new Map(),byLower=new Map(),byLen=[];
  let level=50;
  for(const line of text.split('\n')){
    const word=line.trim();
    if(word.startsWith('#')){const next=Number(word.slice(1));if(Number.isInteger(next))level=next;continue;}
    if(!word||words.has(word))continue;
    words.set(word,level);
    const lower=word.toLowerCase();
    const forms=byLower.get(lower)||[];
    forms.push(word);
    byLower.set(lower,forms);
  }
  for(const [lower,forms] of byLower){
    const n=[...lower].length;
    (byLen[n]||=[]).push([lower,forms,Math.min(...forms.map(form=>words.get(form)??50))]);
  }
  dictionary={words,byLower,byLen};
  return dictionary;
}

export function spelled(dict,word,user){
  let w=normalize(word);
  w=w.endsWith("'s")&&w.length>2?w.slice(0,-2):w;
  w=w.replace(/^'+|'+$/g,'');
  if(!w||[...w].some(ch=>ch>='0'&&ch<='9')||![...w].some(ch=>/\p{L}/u.test(ch)))return true;
  const lower=w.toLowerCase();
  if(user.has(lower)||dict.words.has(w))return true;
  const forms=dict.byLower.get(lower);
  if(!forms)return false;
  const letters=[...w].filter(ch=>/\p{L}/u.test(ch));
  const allCaps=letters.length>1&&letters.every(ch=>ch===ch.toUpperCase());
  const firstCap=w[0]===w[0].toUpperCase()&&[...w].slice(1).every(ch=>ch===ch.toLowerCase());
  return forms.some(form=>{
    const formLower=[...form].every(ch=>ch===ch.toLowerCase());
    const capital=form[0].toUpperCase()+form.slice(1).toLowerCase();
    return allCaps||(formLower&&firstCap)||(firstCap&&capital===w);
  });
}

function distance(a,b,max){
  if(Math.abs(a.length-b.length)>max)return null;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const row=new Array(b.length+1);row[0]=i;
    let best=row[0];
    for(let j=1;j<=b.length;j++){
      const cost=a[i-1]===b[j-1]?0:1;
      row[j]=Math.min(prev[j]+1,row[j-1]+1,prev[j-1]+cost);
      if(row[j]<best)best=row[j];
    }
    if(best>max)return null;
    prev=row;
  }
  return prev[b.length]<=max?prev[b.length]:null;
}

export function suggestions(dict,word,max=5){
  const lower=normalize(word).toLowerCase();
  const chars=[...lower];
  const limit=chars.length<=4?1:2;
  const found=[];
  for(let n=Math.max(1,chars.length-limit);n<=chars.length+limit;n++){
    for(const [candidate,forms,level] of dict.byLen[n]||[]){
      const score=distance(chars,[...candidate],limit);
      if(score!=null)found.push([score,level,forms]);
    }
  }
  found.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const first=word[0]===word[0]?.toUpperCase();
  const out=[];
  for(const [, ,forms] of found){
    for(const form of forms){
      const shown=first?form[0].toUpperCase()+form.slice(1):form;
      if(!out.includes(shown)&&shown.toLowerCase()!==lower)out.push(shown);
      if(out.length>=max)return out;
    }
  }
  return out;
}

export function misspellings(dict,text,user){
  const out=[];
  const re=/[A-Za-z][A-Za-z']*/g;
  let match;
  while((match=re.exec(text))){
    if(!spelled(dict,match[0],user))out.push({start:match.index,end:match.index+match[0].length,word:match[0],suggestions:suggestions(dict,match[0],5)});
  }
  return out;
}

export function addUserWord(word){const words=userWords();const text=String(word||'').trim();if(!text||/\s/.test(text))throw Error('`add` needs a single `word`');const had=[...words].some(item=>item.toLowerCase()===text.toLowerCase());if(!had)words.add(text.toLowerCase());const list=[...words].sort((a,b)=>a.localeCompare(b));saveUser(new Set(list));return {added:!had,word:text,userDictionary:list};}
export function removeUserWord(word){const words=userWords(),text=String(word||'').toLowerCase(),before=words.size;[...words].filter(item=>item.toLowerCase()===text).forEach(item=>words.delete(item));const list=[...words].sort((a,b)=>a.localeCompare(b));saveUser(new Set(list));return {removed:words.size!==before,userDictionary:list};}
export function userDictionary(){return userWords();}
