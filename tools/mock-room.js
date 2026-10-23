// A stand-in for claude.ai's room capability, for testing Remote control and
// Display on your own machine. Two tabs on the same origin talk through a
// BroadcastChannel, and each message is checked against the 4 KB limit.
// Used by linked-test.html; never loaded by the app itself.
(() => {
  const q = new URLSearchParams(location.search).get("mode");
  if (q) localStorage.setItem("glass-prompter.mode", q);
  function makeRoom() {
    const bc = new BroadcastChannel("mockroom");
    const me = Math.random().toString(36).slice(2, 8);
    const L = {}, peerL = [];
    const peers = new Map();
    let mine = {};
    peers.set(me, { peer: me, sameTab: true, isMe: true, presence: {} });
    const snap = () => Object.freeze([...peers.values()]);
    const fire = (joined = []) => { const s = snap(); peerL.forEach((f) => f({ peers: s, joined, left: [], updated: [] })); };
    bc.onmessage = (e) => {
      const m = e.data;
      if (m.kind === "emit") (L[m.topic] || []).forEach((f) => f({ topic: m.topic, data: m.data, peer: m.from, sameTab: false, isMe: false }));
      else if (m.kind === "presence") {
        const isNew = !peers.has(m.from);
        peers.set(m.from, { peer: m.from, sameTab: false, isMe: false, presence: m.presence });
        fire(isNew ? [peers.get(m.from)] : []);
        if (isNew) bc.postMessage({ kind: "presence", from: me, presence: mine });
      }
    };
    setInterval(() => bc.postMessage({ kind: "presence", from: me, presence: mine }), 1000);
    window.__log = [];
    return {
      connected: () => true,
      onConnection(f) { setTimeout(() => f(true), 0); return () => {}; },
      onPeers(f) { peerL.push(f); setTimeout(() => fire([...peers.values()]), 0); return () => {}; },
      on(t, f) { (L[t] = L[t] || []).push(f); return () => {}; },
      emit(t, d) {
        const bytes = new TextEncoder().encode(JSON.stringify(d)).length;
        window.__log.push(t + ":" + bytes);
        if (bytes > 4096) return Promise.reject({ code: "invalid_argument" });
        bc.postMessage({ kind: "emit", topic: t, data: d, from: me });
        (L[t] || []).forEach((f) => f({ topic: t, data: d, peer: me, sameTab: true, isMe: true }));
        return Promise.resolve();
      },
      presence(p) {
        mine = { ...mine, ...p };
        peers.set(me, { peer: me, sameTab: true, isMe: true, presence: mine });
        bc.postMessage({ kind: "presence", from: me, presence: mine });
        fire();
        return Promise.resolve();
      },
      peers: snap,
    };
  }
  window.claude = { use: (n) => n === "room" ? new Promise((res) => setTimeout(() => res(makeRoom()), 50)) : Promise.resolve(null) };
})();
