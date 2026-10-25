import type { FastifyReply, FastifyRequest } from 'fastify'

export function send(reply: FastifyReply, status: number, data: unknown) {
  return reply.code(status).header('cache-control', 'no-store').send(data)
}

export function payload<T extends object>(request: FastifyRequest): T {
  const body = request.body
  return (body && typeof body === 'object' ? body : {}) as T
}

export function query(request: FastifyRequest): Record<string, string | undefined> {
  return request.query as Record<string, string | undefined>
}

export function param(request: FastifyRequest, name: string): string {
  const value = (request.params as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : ''
}
