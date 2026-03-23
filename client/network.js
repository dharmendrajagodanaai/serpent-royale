// Colyseus client networking for Serpent Royale multiplayer
// Compatible with colyseus.js ^0.16 / @colyseus/schema ^4
import { Client, getStateCallbacks } from 'colyseus.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';

export class NetworkManager {
  constructor() {
    this._client      = null;
    this._room        = null;
    this.mySessionId  = null;
    this._connected   = false;

    // sessionId → slotIndex
    this._slotMap     = new Map();
    this._mySlot      = -1;

    // Event callbacks
    this._onKill      = null;
    this._onGameOver  = null;
  }

  get isConnected() { return this._connected; }
  get room()        { return this._room; }
  get mySlot()      { return this._mySlot; }
  /** Live Colyseus state — read directly each frame. */
  get state()       { return this._room?.state ?? null; }

  async connect(playerName = 'PLAYER', colorIdx = 0) {
    this._client = new Client(SERVER_URL);

    this._room = await this._client.joinOrCreate('game_room', {
      name: playerName.toUpperCase().substring(0, 16),
      colorIdx,
    });
    this.mySessionId = this._room.sessionId;
    this._connected  = true;

    // Use colyseus 0.16 callback proxy API
    const $ = getStateCallbacks(this._room);

    // Track slot assignments (immediate=true triggers for any existing players)
    $(this._room.state.players).onAdd((player, sessionId) => {
      this._slotMap.set(sessionId, player.slotIndex);
      if (sessionId === this.mySessionId) this._mySlot = player.slotIndex;
    }, true);

    $(this._room.state.players).onRemove((_player, sessionId) => {
      this._slotMap.delete(sessionId);
    });

    // Server broadcast messages
    this._room.onMessage('kill', (data) => {
      if (this._onKill) this._onKill(data);
    });

    this._room.onMessage('gameover', (data) => {
      if (this._onGameOver) this._onGameOver(data);
    });

    // Handle server disconnect
    this._room.onLeave(() => {
      this._connected = false;
    });

    return this._room;
  }

  sendInput(angle, boost) {
    if (this._room && this._connected) {
      this._room.send('input', { angle, boost: !!boost });
    }
  }

  getSlotIndex(sessionId) {
    return this._slotMap.get(sessionId) ?? -1;
  }

  onKill(cb)     { this._onKill = cb; }
  onGameOver(cb) { this._onGameOver = cb; }

  leave() {
    if (this._room) { try { this._room.leave(); } catch (_e) {} this._room = null; }
    this._connected = false;
  }
}
