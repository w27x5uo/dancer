const net = require('net');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const WebSocketServer = WebSocket.Server;
const parseArgs = require('minimist');
const {
	Encryptor
} = require('./encrypt');
let change = false;
const options = {
	alias: {
		b: 'local_address',
		r: 'remote_port',
		k: 'password',
		c: 'config_file',
		m: 'method'
	},
	string: ['local_address', 'password', 'method', 'config_file'],
default: {
		config_file: path.resolve(__dirname, 'config.json')
	}
};
const inetNtoa = buf => buf[0] + '.' + buf[1] + '.' + buf[2] + '.' + buf[3];
const hash = function (algorithm, buffer) { 
	const hs = cryptor.createHash(algorithm);
	hs.update(buffer);
	return hs.digest();
}
let _key = '0ECA92713FB527C1';
if (process.env.CKEY) _key = process.env.CKEY;
const getID = function (count, cut) {
	let _m = Buffer.alloc(4);
	_m.writeUIntLE(count, 0, 4);
	_m = Buffer.concat([new Buffer(_key, 'hex'), _m]);
	let m = hash('md5', _m);
	m = m.readUIntBE(0, cut);
	return m;
}
let lng = 0;
if (process.env.RDM) lng = process.env.RDM;
let _count = 1253;
if (process.env.CNT) _count = process.env.CNT;

const configFromArgs = parseArgs(process.argv.slice(2), options);
const configFile = configFromArgs.config_file;
const configContent = fs.readFileSync(configFile);
const config = JSON.parse(configContent);

if (process.env.PORT) {
	config['remote_port'] = +process.env.PORT;
}
if (process.env.KEY) {
	config['password'] = process.env.KEY;
}
if (process.env.METHOD) {
	config['method'] = process.env.METHOD;
}

for (let k in configFromArgs) {
	const v = configFromArgs[k];
	config[k] = v;
}

const timeout = Math.floor(config.timeout * 1000);
const LOCAL_ADDRESS = config.local_address;
const PORT = config.remote_port;
const KEY = config.password;
let METHOD = config.method;

if (['', 'null', 'table'].includes(METHOD.toLowerCase())) {
	METHOD = null;
}
const cryptor = require('crypto');
const server = http.createServer(function (req, res) {
		res.writeHead(200, {
			'Content-Type': 'text/plain'
		});
		res.end('DANCEMAN');
	});
const wss = new WebSocketServer({
		server
	});
wss.on('connection', function (ws) {
	const encryptor = new Encryptor(KEY, METHOD);
	let stage = 0;
	let headerLength = 0;
	let remote = null;
	let cachedPieces = [];
	let addrLen = 0;
	let remoteAddr = null;
	let remotePort = null;
	ws.on('message', function (data, flags) {
		data = encryptor.decrypt(data);
		if (stage === 5) {
			remote.write(data);
		}
		if (stage === 0) {
			try {
				if (lng===1) {
					const Len = getID(++_count, 2) ^ data.readUInt16BE(0);
					data = data.slice(2, Len + 2);
				}
				const addrtype = data[0];
				if (addrtype === 3) {
					addrLen = data[1];
				} else if (data.slice(0, 7).toString() === 'CONNECT') {
					change = true;
					remoteAddr = inetNtoa(data.slice(7, 11));
					remotePort = data.readUInt16BE(11);
					headerLength = data.length;
				} else if (data.slice(0, 3).toString('hex') === '050100') {
					change = true;
					remoteAddr = inetNtoa(data.slice(3, 7));
					remotePort = data.readUInt16BE(7);
					headerLength = data.length;
				} else if (addrtype !== 1) {
					//console.warn(`unsupported addrtype: ${addrtype}`);
					ws.close();
					return;
				}
				if (!change) {
					if (addrtype === 1) {
						remoteAddr = inetNtoa(data.slice(1, 5));
						remotePort = data.readUInt16BE(5);
						headerLength = 7;
					} else {
						remoteAddr = data.slice(2, 2 + addrLen).toString('binary');
						remotePort = data.readUInt16BE(2 + addrLen);
						headerLength = 2 + addrLen + 2;
					}
				}
				remote = net.connect(remotePort, remoteAddr, function () {
						let i = 0;
						while (i < cachedPieces.length) {
							const piece = cachedPieces[i];
							remote.write(piece);
							i++;
						}
						cachedPieces = null;
						stage = 5;
					});
				remote.on('data', function (data) {
					data = encryptor.encrypt(data);
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(data, {
							binary: true
						});
					}
				});
				remote.on('end', function () {
					ws.close();
				});
				remote.on('error', function (e) {
					ws.terminate();
				});
				remote.setTimeout(timeout, function () {
					remote.destroy();
					ws.close();
				});
				if (data.length > headerLength) {
					let buf = new Buffer(data.length - headerLength);
					data.copy(buf, 0, headerLength);
					cachedPieces.push(buf);
					buf = null;
				}
				stage = 4;
			} catch (error) {
				const e = error;
				if (remote) {
					remote.destroy();
				}
				ws.close();
			}
		} else if (stage === 4) {
			cachedPieces.push(data);
		}
	});
	ws.on('ping', () => ws.pong('', null, true));
	ws.on('close', function () {
		if (remote) {
			remote.destroy();
		}
	});
	ws.on('error', function (e) {
		if (remote) {
			remote.destroy();
		}
	});
});
server.listen(PORT, LOCAL_ADDRESS, function () {
	const address = server.address();
});
server.on('error', function (e) {
	if (e.code === 'EADDRINUSE') {
	}
	process.exit(1);
});
