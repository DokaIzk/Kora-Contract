import React, { createContext, useContext, useState, ReactNode } from 'react';
import { FlowType, SimulationRequest, SimulationResult } from '../types/simulation';
import { simulationService } from '../services/simulationService';

interface SimulationContextType {
  activeSimulation: SimulationResult | null;
  isLoading: boolean;
  runSimulation: (request: SimulationRequest) => Promise<SimulationResult>;
  clearSimulation: () => void;
  confirmAndSign: () => Promise<{ txHash: string }>;
}

const SimulationContext = createContext<SimulationContextType | undefined>(undefined);

export const SimulationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeSimulation, setActiveSimulation] = useState<SimulationResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const runSimulation = async (request: SimulationRequest): Promise<SimulationResult> => {
    setIsLoading(true);
    try {
      const result = await simulationService.simulateTransaction(request);
      setActiveSimulation(result);
      return result;
    } finally {
      setIsLoading(false);
    }
  };

  const clearSimulation = () => {
    setActiveSimulation(null);
  };

  const confirmAndSign = async (): Promise<{ txHash: string }> => {
    if (!activeSimulation || !activeSimulation.success) {
      throw new Error('Cannot sign: Simulation failed or no active simulation.');
    }
    await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate signing
    const txHash = `0x${Math.random().toString(36).substring(2)}${Date.now().toString(36)}`;
    setActiveSimulation(null);
    return { txHash };
  };

  return (
    <SimulationContext.Provider
      value={{
        activeSimulation,
        isLoading,
        runSimulation,
        clearSimulation,
        confirmAndSign,
      }}
    >
      {children}
    </SimulationContext.Provider>
  );
};

export const useTransactionSimulation = (): SimulationContextType => {
  const context = useContext(SimulationContext);
  if (!context) {
    throw new Error('useTransactionSimulation must be used within a SimulationProvider');
  }
  return context;
};
