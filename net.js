// Peer-to-peer networking via Trystero's BitTorrent tracker strategy.
// No custom backend: two browsers discover each other through public
// WebTorrent trackers, then talk directly over a WebRTC data channel.
import { joinRoom, selfId } from 'https://cdn.jsdelivr.net/npm/@trystero-p2p/torrent@0.25.4/+esm';

const APP_ID = 'j-lubega-neon-pong-v1';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L, easier to read aloud

export { selfId };

export function randomRoomCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function connect(roomId) {
  const room = joinRoom({ appId: APP_ID }, roomId);
  const paddleAction = room.makeAction('paddle');
  const stateAction = room.makeAction('state');
  const rematchAction = room.makeAction('rematch');

  return {
    sendPaddle(y) { paddleAction.send(y); },
    onPaddle(cb) { paddleAction.onMessage = (y) => cb(y); },

    sendState(state) { stateAction.send(state); },
    onState(cb) { stateAction.onMessage = (state) => cb(state); },

    sendRematch() { rematchAction.send(true); },
    onRematch(cb) { rematchAction.onMessage = () => cb(); },

    onPeerJoin(cb) { room.onPeerJoin = cb; },
    onPeerLeave(cb) { room.onPeerLeave = cb; },
    peerCount() { return Object.keys(room.getPeers()).length; },

    leave() { room.leave(); }
  };
}
