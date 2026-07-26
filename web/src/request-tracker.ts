interface Pending<T> {
  resolve: (value: T) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class RequestTracker<T> {
  private readonly pending = new Map<string, Pending<T>>()

  constructor(private readonly timeoutMs = 10_000) {}

  wait(id: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('request timed out'))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  resolve(id: string, value: T): boolean {
    const request = this.take(id)
    request?.resolve(value)
    return !!request
  }

  reject(id: string, reason: Error): boolean {
    const request = this.take(id)
    request?.reject(reason)
    return !!request
  }

  rejectAll(reason: Error): void {
    for (const id of this.pending.keys())
      this.reject(id, reason)
  }

  private take(id: string): Pending<T> | undefined {
    const request = this.pending.get(id)
    if (!request)
      return undefined
    clearTimeout(request.timer)
    this.pending.delete(id)
    return request
  }
}
