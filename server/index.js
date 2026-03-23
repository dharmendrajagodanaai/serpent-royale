import { Server } from 'colyseus';
import { GameRoom } from './GameRoom.js';

const port = Number(process.env.PORT ?? 2567);

const gameServer = new Server();
gameServer.define('game_room', GameRoom);

gameServer.listen(port).then(() => {
  console.log(`[Serpent Royale] Colyseus server running on ws://localhost:${port}`);
}).catch((err) => {
  console.error('[Serpent Royale] Server failed to start:', err);
  process.exit(1);
});
