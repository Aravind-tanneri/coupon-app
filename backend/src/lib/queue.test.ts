import { describe, it, expect, beforeEach } from "vitest";
import { queue } from "./queue.js";

describe("Job Queue Library (§3.3)", () => {
  beforeEach(() => {
    queue.clearTestJobs();
  });

  it("enqueues jobs and records them in test mode", async () => {
    const jobId = await queue.send("notifications:email", {
      to: "student@campus.edu",
      subject: "Test Notification",
    });

    expect(jobId).toBe("test-job-id");
    const jobs = queue.getEnqueuedTestJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe("notifications:email");
    expect(jobs[0]?.data).toEqual({
      to: "student@campus.edu",
      subject: "Test Notification",
    });
  });

  it("registers workers and dispatches enqueued jobs", async () => {
    let processedData: unknown = null;

    await queue.work("notifications:whatsapp", async (data: unknown) => {
      processedData = data;
    });

    await queue.send("notifications:whatsapp", {
      phone: "+919876543210",
      text: "Hello Student",
    });

    // Allow event tick
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(processedData).toEqual({
      phone: "+919876543210",
      text: "Hello Student",
    });
  });
});
