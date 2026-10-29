import { describe, it, expect, beforeEach } from "vitest";
import { IntentClassifier } from "./intent.classifier.js";
import { FakeGeminiClient } from "./gemini.client.js";
import { InjectedStudentContext } from "./gemini.types.js";

describe("Phase 13: Golden-Set Intent Classification (§13.2, §26)", () => {
  let classifier: IntentClassifier;
  let fakeClient: FakeGeminiClient;

  const mockContext: InjectedStudentContext = {
    studentId: "stud-123",
    messId: "akshaya",
    rollNo: "2024CS001",
    studentName: "Rahul Sharma",
    todayIST: "2026-10-29",
  };

  beforeEach(() => {
    fakeClient = new FakeGeminiClient();
    classifier = new IntentClassifier(fakeClient);
  });

  const goldenIntentCases = [
    // MENU_QUERY variants
    { text: "What is for lunch today?", expectedIntent: "MENU_QUERY", expectedMeal: "LUNCH" },
    { text: "Today's dinner menu please", expectedIntent: "MENU_QUERY", expectedMeal: "DINNER" },
    {
      text: "What are they serving for breakfast?",
      expectedIntent: "MENU_QUERY",
      expectedMeal: "BREAKFAST",
    },
    { text: "Snacks menu", expectedIntent: "MENU_QUERY", expectedMeal: "SNACKS" },
    { text: "Show today's menu", expectedIntent: "MENU_QUERY" },
    {
      text: "Can you tell me what's for lunch",
      expectedIntent: "MENU_QUERY",
      expectedMeal: "LUNCH",
    },
    { text: "Tonight's dinner options", expectedIntent: "MENU_QUERY", expectedMeal: "DINNER" },
    { text: "Morning breakfast list", expectedIntent: "MENU_QUERY", expectedMeal: "BREAKFAST" },
    { text: "What is the food menu", expectedIntent: "MENU_QUERY" },
    { text: "Any special snacks today?", expectedIntent: "MENU_QUERY", expectedMeal: "SNACKS" },

    // COUPON_PURCHASE variants
    { text: "I want to buy a lunch coupon", expectedIntent: "COUPON_PURCHASE" },
    { text: "Buy extra dinner coupon", expectedIntent: "COUPON_PURCHASE" },
    { text: "Buy coupon for tomorrow", expectedIntent: "COUPON_PURCHASE" },
    { text: "How can I purchase a meal pass?", expectedIntent: "COUPON_PURCHASE" },
    { text: "Buy breakfast coupon", expectedIntent: "COUPON_PURCHASE" },

    // COUPON_QUERY variants
    { text: "Show my coupons", expectedIntent: "COUPON_QUERY" },
    { text: "Do I have any active passes?", expectedIntent: "COUPON_QUERY" },
    { text: "My meal coupons", expectedIntent: "COUPON_QUERY" },
    { text: "List my coupon passes", expectedIntent: "COUPON_QUERY" },
    { text: "How many coupons do I have?", expectedIntent: "COUPON_QUERY" },

    // REIMBURSEMENT_CALCULATION variants
    {
      text: "Calculate reimbursement for 10 Oct to 17 Oct",
      expectedIntent: "REIMBURSEMENT_CALCULATION",
    },
    {
      text: "How much rebate will I get for my leave?",
      expectedIntent: "REIMBURSEMENT_CALCULATION",
    },
    {
      text: "Calculate mess rebate for 5 days absence",
      expectedIntent: "REIMBURSEMENT_CALCULATION",
    },
    { text: "Reimbursement calculator", expectedIntent: "REIMBURSEMENT_CALCULATION" },
    { text: "How much refund for 12 Oct to 20 Oct?", expectedIntent: "REIMBURSEMENT_CALCULATION" },

    // REIMBURSEMENT_QUERY / STATUS variants
    { text: "What are the reimbursement rules?", expectedIntent: "REIMBURSEMENT_QUERY" },
    { text: "Mess rebate policy", expectedIntent: "REIMBURSEMENT_QUERY" },
    { text: "Check my claim status", expectedIntent: "REIMBURSEMENT_STATUS" },
    { text: "Status of reimbursement claim", expectedIntent: "REIMBURSEMENT_STATUS" },
    { text: "Apply for mess reimbursement", expectedIntent: "REIMBURSEMENT_QUERY" },

    // FEEDBACK variants
    { text: "Food was too salty today", expectedIntent: "FEEDBACK_SUBMISSION" },
    { text: "Mess cleanliness was poor", expectedIntent: "FEEDBACK_SUBMISSION" },
    { text: "5 stars for the paneer butter masala!", expectedIntent: "FEEDBACK_SUBMISSION" },
    { text: "I want to give feedback on hygiene", expectedIntent: "FEEDBACK_SUBMISSION" },
    { text: "Complaint regarding dinner timing", expectedIntent: "FEEDBACK_SUBMISSION" },

    // ANNOUNCEMENTS variants
    { text: "Any announcements from mess committee?", expectedIntent: "ANNOUNCEMENT_QUERY" },
    { text: "Show mess notices", expectedIntent: "ANNOUNCEMENT_QUERY" },
    { text: "Recent announcements", expectedIntent: "ANNOUNCEMENT_QUERY" },

    // HELP & CANCEL variants
    { text: "Help me", expectedIntent: "HELP" },
    { text: "What commands are available?", expectedIntent: "HELP" },
    { text: "Cancel current operation", expectedIntent: "CANCEL" },
    { text: "Stop and go back", expectedIntent: "CANCEL" },
  ];

  for (const testCase of goldenIntentCases) {
    it(`classifies: "${testCase.text}" -> ${testCase.expectedIntent}`, async () => {
      const result = await classifier.classify(testCase.text, mockContext);
      expect(result.intent).toBe(testCase.expectedIntent);

      if (testCase.expectedMeal) {
        expect(result.entities.meal).toBe(testCase.expectedMeal);
      }
    });
  }
});
