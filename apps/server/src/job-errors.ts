export class PermanentJobError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'PermanentJobError'
    }
}

export function shouldRetryJob(error: unknown, attempts: number, maxAttempts: number): boolean {
    return !(error instanceof PermanentJobError) && attempts < maxAttempts
}
