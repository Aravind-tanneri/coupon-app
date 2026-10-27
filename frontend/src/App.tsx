import React from "react";

export const App: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 font-bold text-lg">
          CM
        </div>
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Campus Mess System</h1>
        <p className="text-slate-500 text-sm mt-2">
          Admin portal & mess management service foundation.
        </p>
        <div className="mt-6 inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></span>
          Phase 0 Active
        </div>
      </div>
    </div>
  );
};

export default App;
