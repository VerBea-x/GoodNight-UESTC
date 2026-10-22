import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const cache=new Map();
function dpapi(operation,bytes){
  const input=bytes.toString('base64');
  const script=`Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String('${input}'); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`;
  const encoded=Buffer.from(script,'utf16le').toString('base64');
  const out=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:4096});
  if(out.error||out.status!==0||!out.stdout.trim())throw new Error('Windows 用户密钥不可用');
  return Buffer.from(out.stdout.trim(),'base64');
}
function keyFor(dir){
  if(process.platform!=='win32')return null;
  dir=path.resolve(dir);
  if(cache.has(dir))return cache.get(dir);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'.goodnight-key');
  let key;
  if(fs.existsSync(file))key=dpapi('Unprotect',fs.readFileSync(file));
  else{
    key=crypto.randomBytes(32);
    const wrapped=dpapi('Protect',key);
    try{fs.writeFileSync(file,wrapped,{flag:'wx',mode:0o600,flush:true});}
    catch(e){if(e.code!=='EEXIST')throw e;key=dpapi('Unprotect',fs.readFileSync(file));}
  }
  if(key.length!==32)throw new Error('本机加密密钥无效');
  cache.set(dir,key);return key;
}
export function encodeData(dir,value){
  if(process.platform!=='win32')return JSON.stringify(value);
  const key=keyFor(dir),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return JSON.stringify({_goodnightEncrypted:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});
}
export function decodeData(dir,text){
  const value=JSON.parse(text);
  if(!value||value._goodnightEncrypted!==1)return {value,legacy:process.platform==='win32'};
  if(process.platform!=='win32')throw new Error('加密文件仅可由原 Windows 用户读取');
  const decipher=crypto.createDecipheriv('aes-256-gcm',keyFor(dir),Buffer.from(value.iv,'base64'));
  decipher.setAuthTag(Buffer.from(value.tag,'base64'));
  return {value:JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString('utf8')),legacy:false};
}
