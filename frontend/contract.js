import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.10.0/dist/ethers.min.js";

// ============================================
// CONFIGURATION (UPDATE THESE)
// ============================================
const CONTRACT_ADDRESS = "0xYourDeployedContractAddressHere"; // PASTE DEPLOYED ADDRESS
const EXPECTED_CHAIN_ID = 1029; // Creditcoin testnet chain ID (replace if different)

// ============================================
// INTERNAL STATE (MODULE-SCOPED)
// ============================================
let provider = null;
let signer = null;
let writeContract = null;
let readContract = null;
let contractInterface = null;
let abi = null;

// ============================================
// LOAD ABI AND INITIALIZE READ-ONLY CONTRACT
// ============================================
try {
  // Load ABI from local JSON file
  const response = await fetch("./abi/RevenueLoan.json");
  if (!response.ok) throw new Error(`Failed to load ABI: ${response.statusText}`);
  const raw = await response.json();
  abi = Array.isArray(raw) ? raw : raw.abi;
  if (!abi || !Array.isArray(abi)) {
    throw new Error("Invalid ABI format.");
  }

  // Create contract interface for error decoding
  contractInterface = new ethers.Interface(abi);

  // If window.ethereum is available, set up a read-only provider
  if (window.ethereum) {
    provider = new ethers.BrowserProvider(window.ethereum);
    // Do NOT request accounts here – this provider is for read-only calls
    readContract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
  } else {
    console.warn("No Ethereum provider detected. Read functions will fail until a wallet is connected.");
  }
} catch (err) {
  console.error("Initialization failed:", err);
  // Re-throw to prevent usage with broken ABI
  throw err;
}

// ============================================
// DECODE ERROR HELPER
// ============================================
function decodeError(error) {
  try {
    // Attempt to parse custom error from contract
    if (error.data && contractInterface) {
      const parsed = contractInterface.parseError(error.data);
      if (parsed) return parsed.name;
    }
  } catch (_) {
    // Fall through to fallback messages
  }
  // Fallback to error.shortMessage (Ethers v6) or error.message
  return error.shortMessage || error.message || "Unknown error";
}

// ============================================
// WALLET CONNECTION
// ============================================
export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("MetaMask or another Ethereum wallet is required.");
  }

  // Request account access
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts returned.");
  }

  // Create provider and get network
  const tempProvider = new ethers.BrowserProvider(window.ethereum);
  const network = await tempProvider.getNetwork();
  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error(`Wrong network. Please switch to Creditcoin testnet (chain ID: ${EXPECTED_CHAIN_ID}).`);
  }

  // Update module state
  provider = tempProvider;
  signer = await provider.getSigner();
  // Re-create readContract with the same provider (still read-only, but now provider is authenticated)
  // We keep readContract for reads, and writeContract for writes
  readContract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
  writeContract = new ethers.Contract(CONTRACT_ADDRESS, abi, signer);

  return accounts[0];
}

// ============================================
// READ FUNCTIONS (no signer required)
// ============================================

// Internal helper to ensure readContract is available
function ensureReadContract() {
  if (!readContract) throw new Error("No provider available. Please install MetaMask or connect wallet.");
}

/**
 * Get a single loan by ID.
 * Returns object with exact struct field names, formatted appropriately.
 */
export async function getLoan(loanId) {
  ensureReadContract();
  if (loanId === undefined || loanId === null || loanId <= 0) {
    throw new Error("Invalid loan ID.");
  }

  const loan = await readContract.getLoan(loanId);
  // Loan is returned as a tuple/object with named properties
  return {
    borrower: loan.borrower,
    lender: loan.lender,
    principal: ethers.formatEther(loan.principal),
    revenueSharePercent: loan.revenueSharePercent.toString(),
    repaymentCapPercent: loan.repaymentCapPercent.toString(),
    totalRepaid: ethers.formatEther(loan.totalRepaid),
    funded: loan.funded,
    active: loan.active,
    collateralAmount: ethers.formatEther(loan.collateralAmount),
    startTime: loan.startTime.toString(),
    duration: loan.duration.toString()
  };
}

/**
 * Get all loans (from ID 0 to nextLoanId-1).
 */
export async function getAllLoans() {
  ensureReadContract();
  const nextId = await readContract.nextLoanId();
  const loans = [];
  for (let i = 1; i < nextId; i++) {
    try {
      const loan = await getLoan(i);
      loans.push(loan);
    } catch (err) {
      // If a loan fetch fails, skip it or rethrow? For robustness, we skip.
      console.warn(`Failed to fetch loan ${i}:`, decodeError(err));
    }
  }
  return loans;
}

/**
 * Get the next loan ID (total number of loans created so far).
 */
export async function getNextLoanId() {
  ensureReadContract();
  const nextId = await readContract.nextLoanId();
  return nextId.toString();
}

// ============================================
// WRITE FUNCTIONS (require signer)
// ============================================

function ensureWriteContract() {
  if (!writeContract) throw new Error("Wallet not connected. Please call connectWallet() first.");
}

/**
 * Create a new loan.
 * @param {Object} params
 * @param {string} params.principalEth - Principal amount in ETH (will be parsed)
 * @param {number|string} params.revenueSharePercent - Percentage (e.g., 10 for 10%)
 * @param {number|string} params.repaymentCapPercent - Percentage (e.g., 150 for 150%)
 * @param {number|string} params.durationSeconds - Loan duration in seconds
 * @param {string} params.collateralEth - Collateral amount in ETH (may be "0")
 * @returns {Promise<string>} Transaction hash
 */
export async function createLoan({ principalEth, revenueSharePercent, repaymentCapPercent, durationSeconds, collateralEth }) {
  ensureWriteContract();

  // Basic validation
  if (!principalEth || parseFloat(principalEth) <= 0) {
    throw new Error("Principal must be positive.");
  }
  // Collateral can be zero, so no validation needed.

  try {
    const principalWei = ethers.parseEther(principalEth);
    const collateralWei = ethers.parseEther(collateralEth || "0");
    const tx = await writeContract.createLoan(
      principalWei,
      revenueSharePercent,
      repaymentCapPercent,
      durationSeconds,
      { value: collateralWei }
    );
    const receipt = await tx.wait();
    return receipt.hash;
  } catch (err) {
    throw new Error(decodeError(err));
  }
}

/**
 * Fund an existing loan.
 * @param {number|string} loanId
 * @param {string} principalEth - Amount to fund (must equal loan principal)
 * @returns {Promise<string>} Transaction hash
 */
export async function fundLoan(loanId, principalEth) {
  ensureWriteContract();
  if (loanId === undefined || loanId === null || loanId <= 0) throw new Error("Invalid loan ID.");

  try {
    const principalWei = ethers.parseEther(principalEth);
    const tx = await writeContract.fundLoan(loanId, { value: principalWei });
    const receipt = await tx.wait();
    return receipt.hash;
  } catch (err) {
    throw new Error(decodeError(err));
  }
}

/**
 * Repay part or all of a loan.
 * @param {number|string} loanId
 * @param {string} repayEth - Amount to repay in ETH
 * @returns {Promise<string>} Transaction hash
 */
export async function repayLoan(loanId, repayEth) {
  ensureWriteContract();
  if (loanId === undefined || loanId === null || loanId <= 0) throw new Error("Invalid loan ID.");

  try {
    const repayWei = ethers.parseEther(repayEth);
    const tx = await writeContract.repay(loanId, { value: repayWei });
    const receipt = await tx.wait();
    return receipt.hash;
  } catch (err) {
    throw new Error(decodeError(err));
  }
}

/**
 * Claim collateral for a defaulted loan.
 * @param {number|string} loanId
 * @returns {Promise<string>} Transaction hash
 */
export async function claimCollateral(loanId) {
  ensureWriteContract();
  if (loanId === undefined || loanId === null || loanId <= 0) throw new Error("Invalid loan ID.");

  try {
    const tx = await writeContract.claimCollateral(loanId);
    const receipt = await tx.wait();
    return receipt.hash;
  } catch (err) {
    throw new Error(decodeError(err));
  }
}

// ============================================
// UTILITY: Check if wallet is connected
// ============================================
export function isWalletConnected() {
  return signer !== null;
}

// ============================================
// UTILITY: Get current connected address
// ============================================
export async function getCurrentAddress() {
  if (!signer) return null;
  return await signer.getAddress();
}