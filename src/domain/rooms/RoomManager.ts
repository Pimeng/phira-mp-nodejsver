/*
 * MIT License
 * Copyright (c) 2024
 */

import { Logger } from '../../logging/logger';
import { UserInfo, RoomState } from '../protocol/Commands';

export interface PlayerInfo {
  user: UserInfo;
  connectionId: string;
  isReady: boolean;
}

export interface Room {
  id: string;
  name: string;
  ownerId: number;
  players: Map<number, PlayerInfo>;
  maxPlayers: number;
  password?: string;
  state: RoomState;
  locked: boolean;
  cycle: boolean;
  live: boolean;
  createdAt: number;
}

export interface CreateRoomOptions {
  id: string;
  name: string;
  ownerId: number;
  ownerInfo: UserInfo;
  connectionId: string;
  maxPlayers?: number;
  password?: string;
}

export interface RoomManager {
  createRoom(options: CreateRoomOptions): Room;
  getRoom(id: string): Room | undefined;
  deleteRoom(id: string): boolean;
  listRooms(): Room[];
  count(): number;
  addPlayerToRoom(roomId: string, userId: number, userInfo: UserInfo, connectionId: string): boolean;
  removePlayerFromRoom(roomId: string, userId: number): boolean;
  getRoomByUserId(userId: number): Room | undefined;
  setRoomState(roomId: string, state: RoomState): boolean;
  setRoomLocked(roomId: string, locked: boolean): boolean;
  setRoomCycle(roomId: string, cycle: boolean): boolean;
  setPlayerReady(roomId: string, userId: number, ready: boolean): boolean;
  isRoomOwner(roomId: string, userId: number): boolean;
  changeRoomOwner(roomId: string, newOwnerId: number): boolean;
  cleanupEmptyRooms(): void;
}

export class InMemoryRoomManager implements RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly logger: Logger) {}

  createRoom(options: CreateRoomOptions): Room {
    const { id, name, ownerId, ownerInfo, connectionId, maxPlayers = 8, password } = options;

    if (this.rooms.has(id)) {
      throw new Error(`Room with id ${id} already exists`);
    }

    const players = new Map<number, PlayerInfo>();
    players.set(ownerId, {
      user: ownerInfo,
      connectionId,
      isReady: false,
    });

    const room: Room = {
      id,
      name,
      ownerId,
      players,
      maxPlayers,
      password,
      state: { state: 'SelectChart' },
      locked: false,
      cycle: false,
      live: true,
      createdAt: Date.now(),
    };

    this.rooms.set(id, room);
    this.logger.info('Room created', { id, name, ownerId, totalRooms: this.rooms.size });

    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  deleteRoom(id: string): boolean {
    const deleted = this.rooms.delete(id);

    if (deleted) {
      this.logger.info('Room deleted', { id, totalRooms: this.rooms.size });
    }

    return deleted;
  }

  listRooms(): Room[] {
    return [...this.rooms.values()];
  }

  count(): number {
    return this.rooms.size;
  }

  addPlayerToRoom(
    roomId: string,
    userId: number,
    userInfo: UserInfo,
    connectionId: string,
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      this.logger.warn('Cannot add player to non-existent room', { roomId, userId });
      return false;
    }

    if (room.players.size >= room.maxPlayers) {
      this.logger.warn('Cannot add player to full room', { roomId, userId, maxPlayers: room.maxPlayers });
      return false;
    }

    if (room.locked) {
      this.logger.warn('Cannot add player to locked room', { roomId, userId });
      return false;
    }

    room.players.set(userId, {
      user: userInfo,
      connectionId,
      isReady: false,
    });

    this.logger.info('Player added to room', { roomId, userId, playerCount: room.players.size });
    return true;
  }

  removePlayerFromRoom(roomId: string, userId: number): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const removed = room.players.delete(userId);
    if (removed) {
      this.logger.info('Player removed from room', { roomId, userId, playerCount: room.players.size });

      if (room.players.size === 0) {
        this.deleteRoom(roomId);
      } else if (room.ownerId === userId) {
        const newOwner = Array.from(room.players.keys())[0];
        this.changeRoomOwner(roomId, newOwner);
      }
    }

    return removed;
  }

  getRoomByUserId(userId: number): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.players.has(userId)) {
        return room;
      }
    }
    return undefined;
  }

  setRoomState(roomId: string, state: RoomState): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    room.state = state;
    this.logger.debug('Room state changed', { roomId, state: state.state });
    return true;
  }

  setRoomLocked(roomId: string, locked: boolean): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    room.locked = locked;
    this.logger.debug('Room lock changed', { roomId, locked });
    return true;
  }

  setRoomCycle(roomId: string, cycle: boolean): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    room.cycle = cycle;
    this.logger.debug('Room cycle changed', { roomId, cycle });
    return true;
  }

  setPlayerReady(roomId: string, userId: number, ready: boolean): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const player = room.players.get(userId);
    if (!player) {
      return false;
    }

    player.isReady = ready;
    this.logger.debug('Player ready state changed', { roomId, userId, ready });
    return true;
  }

  isRoomOwner(roomId: string, userId: number): boolean {
    const room = this.rooms.get(roomId);
    return room ? room.ownerId === userId : false;
  }

  changeRoomOwner(roomId: string, newOwnerId: number): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !room.players.has(newOwnerId)) {
      return false;
    }

    room.ownerId = newOwnerId;
    this.logger.info('Room owner changed', { roomId, newOwnerId });
    return true;
  }

  cleanupEmptyRooms(): void {
    const emptyRooms: string[] = [];
    for (const [id, room] of this.rooms.entries()) {
      if (room.players.size === 0) {
        emptyRooms.push(id);
      }
    }

    emptyRooms.forEach((id) => this.deleteRoom(id));
    if (emptyRooms.length > 0) {
      this.logger.info('Empty rooms cleaned up', { count: emptyRooms.length });
    }
  }
}
