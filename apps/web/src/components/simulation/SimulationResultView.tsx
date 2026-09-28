import React from 'react';
import { SimulationResult } from '../../types/simulation';

interface SimulationResultViewProps {
  simulation: SimulationResult;
}

export const SimulationResultView: React.FC<SimulationResultViewProps> = ({ simulation }) => {
  if (!simulation.success) {
    return (
      <div className="simulation-failure border border-red-200 bg-red-50 p-4 rounded-xl">
        <div className="flex items-center space-x-2 text-red-700 font-semibold text-sm">
          <span className="text-lg">⚠️</span>
          <span>Simulation Blocked: Transaction Would Fail</span>
        </div>
        <p className="text-xs text-red-600 mt-2">{simulation.errorReason}</p>
        <p className="text-[11px] text-gray-500 mt-2">
          Your wallet signature has been blocked to prevent unnecessary gas consumption and transaction failure.
        </p>
      </div>
    );
  }

  return (
    <div className="simulation-success space-y-4">
      <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl flex items-center justify-between">
        <div className="flex items-center space-x-2 text-emerald-800 font-semibold text-xs">
          <span>✅</span>
          <span>Pre-flight Simulation Succeeded</span>
        </div>
        <span className="text-[11px] text-emerald-600">Time: {simulation.simulationTimeMs}ms</span>
      </div>

      {/* Decoded State Changes Table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700">
          Decoded State Changes Preview
        </div>
        <div className="divide-y divide-gray-100">
          {simulation.stateChanges.map((item, idx) => (
            <div key={idx} className="p-3 text-xs flex justify-between items-center">
              <div>
                <span className="font-medium text-gray-900">{item.label}</span>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {item.before} → <span className="text-gray-700">{item.after}</span>
                </div>
              </div>
              <span className={`font-semibold ${item.delta.startsWith('-') ? 'text-red-600' : 'text-emerald-600'}`}>
                {item.delta}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Network & Gas Metrics */}
      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-500 bg-gray-50 p-2.5 rounded-lg border border-gray-100">
        <div>
          Estimated Fee: <span className="font-medium text-gray-800">${simulation.feeChargedUsd}</span>
        </div>
        <div>
          CPU Instructions: <span className="font-medium text-gray-800">{simulation.cpuInstructions.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
};
