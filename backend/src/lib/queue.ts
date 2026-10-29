import { PgBoss } from "pg-boss";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export interface EnqueueOptions {
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
}

export type JobHandler<T = unknown> = (data: T) => Promise<void>;

export class JobQueue {
  private boss: PgBoss | null = null;
  private isTest = env.NODE_ENV === "test";
  private memoryHandlers = new Map<string, JobHandler<unknown>>();
  private memoryJobs: Array<{ name: string; data: unknown }> = [];

  async start(): Promise<void> {
    if (this.isTest) {
      logger.info("Test environment: using in-memory job queue runner.");
      return;
    }

    if (!this.boss) {
      this.boss = new PgBoss(env.DATABASE_URL);

      this.boss.on("error", (error: Error) => {
        logger.error({ error }, "pg-boss background queue error");
      });

      await this.boss.start();
      logger.info("pg-boss background job queue started successfully.");
    }
  }

  async stop(): Promise<void> {
    if (this.boss) {
      await this.boss.stop();
      this.boss = null;
      logger.info("pg-boss background job queue stopped.");
    }
  }

  async send<T = unknown>(
    name: string,
    data: T,
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    if (this.isTest) {
      this.memoryJobs.push({ name, data });
      const handler = this.memoryHandlers.get(name);
      if (handler) {
        // Execute asynchronously in test
        setTimeout(() => {
          handler(data).catch((err) => {
            logger.warn({ err, queue: name }, "In-memory test job execution error");
          });
        }, 0);
      }
      return "test-job-id";
    }

    if (!this.boss) {
      await this.start();
    }

    return (
      (await this.boss?.send(name, data as object, {
        retryLimit: options.retryLimit ?? 3,
        retryDelay: options.retryDelay ?? 10,
        retryBackoff: options.retryBackoff ?? true,
        expireInSeconds: options.expireInSeconds ?? 300,
      })) ?? null
    );
  }

  async work<T = unknown>(name: string, handler: JobHandler<T>): Promise<void> {
    if (this.isTest) {
      this.memoryHandlers.set(name, handler as JobHandler<unknown>);
      return;
    }

    if (!this.boss) {
      await this.start();
    }

    await this.boss?.work(name, async (jobs) => {
      for (const job of jobs) {
        await handler(job.data as T);
      }
    });
  }

  getEnqueuedTestJobs(): Array<{ name: string; data: unknown }> {
    return [...this.memoryJobs];
  }

  clearTestJobs(): void {
    this.memoryJobs = [];
  }
}

export const queue = new JobQueue();
export const jobQueue = queue;
