import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fetch as handle} from './web/server.mjs';

const root = resolve('web'), dataRoot = resolve('.data'), namespace = 'local-palette-analysis';
await mkdir(resolve(dataRoot, 'assets'), {recursive: true});
let records = {};
try {records = JSON.parse(await readFile(resolve(dataRoot, 'records.json'), 'utf8'));} catch (error) {if (error.code !== 'ENOENT') throw error;}
let writes = Promise.resolve();
const persist = () => {
  const snapshot = JSON.stringify(records);
  const writing = writes.then(async () => {const target = resolve(dataRoot, 'records.json'); await writeFile(target + '.tmp', snapshot, {mode: 0o600}); await rename(target + '.tmp', target);});
  writes = writing.catch(() => {}); return writing;
};
const missing = () => Object.assign(Error('Not found'), {status: 404});
const ink = {
  data: {
    async get(id) {if (!records[id]) throw missing(); return structuredClone(records[id]);},
    async list({kind, namespace: ns}) {return Object.values(records).filter(o => o.kind === kind && o.namespace === ns).map(o => structuredClone(o));},
    async create(input) {
      const id = input.id || randomBytes(16).toString('hex');
      if (records[id]) throw Object.assign(Error('Already exists'), {status: 409});
      const object = {...input, id, namespace, revision: 1, created: Date.now(), updated: Date.now()};
      records[id] = object; await persist(); return structuredClone(object);
    },
    async update(id, changes, expected) {
      if (!records[id]) throw missing();
      if (records[id].revision !== expected) throw Object.assign(Error('Revision conflict'), {status: 409});
      records[id] = {...records[id], ...changes, revision: expected + 1, updated: Date.now()};
      const object = structuredClone(records[id]); await persist(); return object;
    }
  },
  assets: {
    async put(bytes, {mime, title}) {
      const id = randomBytes(16).toString('hex');
      await writeFile(resolve(dataRoot, 'assets', id + '.png'), bytes);
      return ink.data.create({id, kind: 'file', title, body: JSON.stringify({mime, bytes: bytes.length})});
    },
    async get(id) {if (!/^[a-f0-9]{32}$/.test(id)) throw missing(); return readFile(resolve(dataRoot, 'assets', id + '.png'));}
  }
};
const types = {'.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.lua': 'text/plain', '.json': 'application/json'};
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(req.url, 'http://127.0.0.1:' + server.address().port);
    if (req.headers.origin && req.headers.origin !== url.origin) {res.writeHead(403); res.end('Origin denied'); return;}
    if (url.pathname === '/upload' && req.method === 'POST') {
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>34*1024*1024)throw Object.assign(Error('Image too large'),{status:413});chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks));
      const file=await ink.assets.put(Buffer.from(input.base64,'base64'),{mime:input.mime,title:input.name});
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({file}));return;
    }
    if (url.pathname.startsWith('/backend/')) {
      const chunks = []; let size = 0;
      for await (const chunk of req) {size += chunk.length; if (size > 34*1024*1024) throw Object.assign(Error('Request too large'), {status: 413}); chunks.push(chunk);}
      const body = Buffer.concat(chunks);
      const request = new Request(new URL(url.pathname.slice('/backend'.length), url), {method: req.method, ...(body.length ? {body, headers: {'Content-Type': 'application/json'}} : {})});
      const response = await handle(request, {ink, namespace});
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep) || path.endsWith(sep + 'server.mjs')) throw missing();
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream'); res.end(await readFile(path));
  } catch (error) {res.writeHead(error.status || 404, {'Content-Type': 'application/json'}); res.end(JSON.stringify({error: error.status ? error.message : 'Not found'}));}
});
server.listen(Number(process.env.PORT || 4678), '127.0.0.1', () => console.log('Palette Analysis on http://127.0.0.1:' + server.address().port));
