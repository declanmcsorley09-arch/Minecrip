import { S2C } from './Protocol.js';
import { WeatherType } from '../world/Weather.js';
import { itemRegistry } from '../items/index.js';
import { ENTITY_TYPES } from '../entities/EntityTypes.js';

/**
 * Server chat commands (single-player cheats / administration).
 * @module networking/Commands
 */

/** Help text listing available commands. */
export const COMMAND_HELP = [
  '/time set <day|noon|night|midnight|ticks>',
  '/time speed <multiplier>',
  '/weather <clear|rain|thunder>',
  '/gamemode <survival|creative>',
  '/tp <x> <y> <z>',
  '/give <item> [count]',
  '/summon <sheep|cow|pig|zombie|skeleton>',
  '/kill',
  '/seed',
  '/spawnpoint',
  '/rule <peaceful|mobSpawning|daylightCycle|weatherCycle|keepInventory> <true|false>',
];

const TIMES = { day: 1000, noon: 6000, sunset: 11500, night: 13000, midnight: 18000, sunrise: 23500 };

/**
 * Executes a command.
 * @param {import('./GameServer.js').GameServer} server
 * @param {import('./ServerPlayer.js').ServerPlayer} player
 * @param {string} line command without the leading slash
 * @returns {{text:string, error?:boolean}|null}
 */
export function runCommand(server, player, line) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  const ok = (text) => ({ text });
  const err = (text) => ({ text, error: true });
  switch ((cmd ?? '').toLowerCase()) {
    case 'help':
      return ok(COMMAND_HELP.join('\n'));
    case 'time': {
      if (args[0] === 'set') {
        const v = TIMES[args[1]] ?? Number(args[1]);
        if (!Number.isFinite(v)) return err('Usage: /time set <day|noon|night|midnight|ticks>');
        server.cycle.setDayTime(v);
        server.broadcast({ type: S2C.TIME_SYNC, time: server.cycle.time });
        return ok(`Time set to ${server.cycle.formatClock()}`);
      }
      if (args[0] === 'speed') {
        const v = Number(args[1]);
        if (!Number.isFinite(v) || v < 0 || v > 1000) return err('Usage: /time speed <0..1000>');
        server.cycle.speed = v;
        server.broadcast({ type: S2C.TIME_SYNC, time: server.cycle.time, speed: v });
        return ok(`Time speed ${v}x`);
      }
      return ok(`Day ${server.cycle.day}, ${server.cycle.formatClock()}`);
    }
    case 'weather': {
      const type = args[0];
      if (![WeatherType.CLEAR, WeatherType.RAIN, WeatherType.THUNDER].includes(type)) return err('Usage: /weather <clear|rain|thunder>');
      server.weather.set(type);
      return ok(`Weather set to ${type}`);
    }
    case 'gamemode':
    case 'gm': {
      const aliases = { 0: 'survival', 1: 'creative', s: 'survival', c: 'creative' };
      const mode = aliases[args[0]] ?? args[0];
      if (mode !== 'survival' && mode !== 'creative') return err('Usage: /gamemode <survival|creative>');
      server.setGameMode(player, mode);
      return ok(`Game mode set to ${mode}`);
    }
    case 'tp': {
      const [x, y, z] = args.map(Number);
      if (![x, y, z].every(Number.isFinite)) return err('Usage: /tp <x> <y> <z>');
      player.x = x;
      player.y = y;
      player.z = z;
      player.fallPeakY = null;
      player.send({ type: S2C.PLAYER_CORRECTION, seq: player.lastSeq, x, y, z, teleport: true });
      return ok(`Teleported to ${x} ${y} ${z}`);
    }
    case 'give': {
      const item = itemRegistry.getByName(args[0] ?? '');
      if (!item) return err(`Unknown item: ${args[0] ?? ''}`);
      const count = Math.max(1, Math.min(64 * 36, Number(args[1] ?? 1) | 0));
      let left = count;
      while (left > 0) {
        const n = Math.min(left, item.maxStack);
        player.send({ type: S2C.ITEM_PICKUP, entityId: 0, stack: { id: item.id, count: n, damage: 0 } });
        left -= n;
      }
      return ok(`Gave ${count} ${item.displayName}`);
    }
    case 'summon': {
      const info = ENTITY_TYPES[args[0]];
      if (!info || !info.create) return err('Usage: /summon <sheep|cow|pig|zombie|skeleton>');
      const a = player.yaw;
      server.spawner.spawn(server.ctx, args[0], player.x - Math.sin(a) * 3, player.y + 0.5, player.z - Math.cos(a) * 3);
      return ok(`Summoned ${info.displayName}`);
    }
    case 'kill':
      if (player.gameMode === 'creative') {
        player.gameMode = 'survival';
        server.damagePlayer(player, 1000, null, 'kill', true);
        player.gameMode = 'creative';
        return null;
      }
      server.damagePlayer(player, 1000, null, 'kill', true);
      return null;
    case 'seed':
      return ok(`Seed: ${server.world.seed}`);
    case 'spawnpoint':
      player.spawn = { x: player.x, y: player.y, z: player.z };
      return ok(`Spawn point set to ${Math.floor(player.x)} ${Math.floor(player.y)} ${Math.floor(player.z)}`);
    case 'rule': {
      const [name, value] = args;
      if (!(name in server.rules) || (value !== 'true' && value !== 'false')) return err(`Usage: ${COMMAND_HELP[COMMAND_HELP.length - 1]}`);
      server.rules[name] = value === 'true';
      return ok(`Rule ${name} = ${value}`);
    }
    default:
      return err(`Unknown command: /${cmd}. Type /help`);
  }
}
