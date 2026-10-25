import type { FastifyReply, FastifyRequest } from 'fastify'

export function send(reply: FastifyReply, status: number, data: unknown) {
  return reply.code(status).header('cache-control', 'no-store').send(data)
}

export function payload<T extends object>(request: FastifyRequest): T {
  const body = request.body
  return (body && typeof body === 'object' ? body : {}) as T
}

export function searchParams(request: FastifyRequest): URLSearchParams {
  const host = Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host
  return new URL(request.url, `http://${host ?? 'localhost'}`).searchParams
}

export function param(request: FastifyRequest, name: string): string {
  const value = (request.params as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : ''
}
