"use strict";
/**
 * Prisma Client Mock
 *
 * Mapped to "@prisma/client" by moduleNameMapper in jest.config.js so Jest
 * never tries to resolve / generate the real Prisma client. The project uses
 * Drizzle ORM for all DB access; Prisma is only a transitive dependency.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaClient = void 0;
class PrismaClient {
    $connect() { return Promise.resolve(); }
    $disconnect() { return Promise.resolve(); }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction(fn) { return fn(this); }
}
exports.PrismaClient = PrismaClient;
exports.default = { PrismaClient };
