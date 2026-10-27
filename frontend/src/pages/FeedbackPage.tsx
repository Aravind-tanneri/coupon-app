import React from "react";
import { MessageSquare } from "lucide-react";

export const FeedbackPage: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Feedback & Sentiment</h1>
        <p className="text-sm text-slate-500 mt-1">
          Student meal feedback, ratings, and issue resolution workflows.
        </p>
      </div>
      <div className="p-8 bg-white border border-slate-200 rounded-xl text-center text-slate-500">
        <MessageSquare className="w-10 h-10 text-slate-400 mx-auto mb-2" />
        <p className="font-medium text-slate-700">Feedback analytics ready for Phase 8</p>
      </div>
    </div>
  );
};
