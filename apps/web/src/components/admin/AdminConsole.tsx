import React, { useState } from 'react';
import { AdminConsoleState, MultiSigProposal, ProtocolParameterKey } from '../../types/admin';
import { adminService } from '../../services/adminService';

interface AdminConsoleProps {
  userWalletAddress?: string;
}

export const AdminConsole: React.FC<AdminConsoleProps> = ({
  userWalletAddress = 'G_SIGNER_ALPHA_01',
}) => {
  const [adminState, setAdminState] = useState<AdminConsoleState>(
    adminService.getAdminState(userWalletAddress)
  );

  const [selectedKey, setSelectedKey] = useState<ProtocolParameterKey>('FEE_TIERS');
  const [proposedValInput, setProposedValInput] = useState<string>('0.40%');
  const [effectDescInput, setEffectDescInput] = useState<string>('Adjust platform fee percentage.');
  const [msg, setMsg] = useState<string | null>(null);

  if (!adminState.isAuthorizedSigner) {
    return (
      <div
        className="admin-console p-6 bg-rose-50 border border-rose-200 rounded-2xl text-center max-w-lg mx-auto"
        role="alert"
      >
        <h2 className="text-base font-bold text-rose-900 mb-1">Access Restricted</h2>
        <p className="text-xs text-rose-700">
          Wallet Address <code>{userWalletAddress}</code> is not an authorized multi-sig signer for the protocol parameter admin console.
        </p>
      </div>
    );
  }

  const handleCreateProposal = (e: React.FormEvent) => {
    e.preventDefault();
    adminService.createProposal(selectedKey, proposedValInput, userWalletAddress, effectDescInput);
    setAdminState(adminService.getAdminState(userWalletAddress));
    setMsg(`Successfully created proposal for ${selectedKey}`);
  };

  const handleSignProposal = (proposalId: string) => {
    adminService.signProposal(proposalId, userWalletAddress);
    setAdminState(adminService.getAdminState(userWalletAddress));
    setMsg(`Approved proposal ${proposalId}`);
  };

  const handleExecuteProposal = (proposalId: string) => {
    adminService.executeProposal(proposalId);
    setAdminState(adminService.getAdminState(userWalletAddress));
    setMsg(`Executed proposal ${proposalId} on-chain!`);
  };

  return (
    <div
      className="admin-console bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 shadow-sm max-w-4xl mx-auto space-y-6"
      role="region"
      aria-label="Admin console for protocol parameter management"
    >
      <div className="flex items-center justify-between flex-wrap gap-2 border-b border-gray-100 pb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Protocol Parameter Admin Console</h2>
          <p className="text-xs text-gray-500">Multi-sig timelocked parameter management</p>
        </div>

        <div className="text-xs font-semibold px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-full">
          Authorized Signer: {userWalletAddress.slice(0, 10)}…
        </div>
      </div>

      {msg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium">
          {msg}
        </div>
      )}

      {/* Active Configurable Parameters Table */}
      <div>
        <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider mb-3">
          Current Configurable Parameters
        </h3>

        <div className="overflow-x-auto border border-gray-200 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-700 font-semibold border-b border-gray-200">
              <tr>
                <th className="p-3">Parameter Name</th>
                <th className="p-3">Current Value</th>
                <th className="p-3">Last Modified By</th>
                <th className="p-3">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {adminState.parameters.map((param) => (
                <tr key={param.key} className="hover:bg-gray-50">
                  <td className="p-3 font-semibold text-gray-900">{param.label}</td>
                  <td className="p-3 text-indigo-600 font-bold">{param.currentValue}</td>
                  <td className="p-3 text-gray-600 font-mono">{param.lastModifiedBy}</td>
                  <td className="p-3 text-gray-500">{new Date(param.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Proposal Creation Form */}
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
        <h3 className="text-xs font-bold text-gray-900 mb-3 uppercase tracking-wider">
          Propose Parameter Modification
        </h3>

        <form onSubmit={handleCreateProposal} className="space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-gray-700 mb-1">Target Parameter</label>
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value as ProtocolParameterKey)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              >
                {adminState.parameters.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-gray-700 mb-1">Proposed New Value</label>
              <input
                type="text"
                value={proposedValInput}
                onChange={(e) => setProposedValInput(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-gray-700 mb-1">Effect Description & Rationale</label>
            <input
              type="text"
              value={effectDescInput}
              onChange={(e) => setEffectDescInput(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              required
            />
          </div>

          <button
            type="submit"
            className="py-2.5 px-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
          >
            Submit Multi-Sig Proposal
          </button>
        </form>
      </div>

      {/* Pending Multi-Sig Proposals */}
      <div>
        <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider mb-3">
          Pending Multi-Sig Proposals awaiting Quorum
        </h3>

        <div className="space-y-3">
          {adminState.proposals.map((prop) => {
            const hasSigned = prop.currentSignatures.includes(userWalletAddress);
            const reachesQuorum = prop.currentSignatures.length >= prop.requiredSignatures;

            return (
              <div key={prop.id} className="p-4 bg-white border border-gray-200 rounded-xl space-y-2 text-xs">
                <div className="flex justify-between items-center flex-wrap gap-2">
                  <span className="font-bold text-gray-900 text-sm">{prop.parameterLabel} ({prop.id})</span>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    prop.status === 'EXECUTED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : prop.status === 'APPROVED'
                      ? 'bg-indigo-100 text-indigo-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}>
                    {prop.status} ({prop.currentSignatures.length}/{prop.requiredSignatures} Signatures)
                  </span>
                </div>

                <div className="p-2 bg-gray-50 border border-gray-200 rounded-lg space-y-1">
                  <div><strong>Before:</strong> {prop.currentValue}</div>
                  <div><strong>Proposed:</strong> <span className="text-indigo-600 font-bold">{prop.proposedValue}</span></div>
                  <div><strong>Effect:</strong> {prop.effectDescription}</div>
                </div>

                <div className="flex gap-2 pt-1">
                  {!hasSigned && prop.status === 'PENDING' && (
                    <button
                      type="button"
                      onClick={() => handleSignProposal(prop.id)}
                      className="px-3 py-1.5 bg-indigo-600 text-white font-semibold text-xs rounded-lg hover:bg-indigo-700"
                    >
                      Approve & Sign Proposal
                    </button>
                  )}

                  {reachesQuorum && prop.status !== 'EXECUTED' && (
                    <button
                      type="button"
                      onClick={() => handleExecuteProposal(prop.id)}
                      className="px-3 py-1.5 bg-emerald-600 text-white font-semibold text-xs rounded-lg hover:bg-emerald-700"
                    >
                      Execute On-Chain Upgrade
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
