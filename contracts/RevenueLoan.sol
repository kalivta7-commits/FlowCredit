// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title RevenueLoan
 * @author FlowCredit Protocol
 * @notice Revenue-based lending protocol with optional borrower collateral, full pausability,
 *         and reentrancy protection. Implements checks-effects-interactions throughout.
 * @dev Storage layout is intentionally preserved for upgrade compatibility.
 *      All error paths use custom errors for maximum gas efficiency.
 *      OpenZeppelin v5 compatible.
 */
contract RevenueLoan is ReentrancyGuard, Ownable, Pausable {

    // ────────────────────────────────────────────────────────────
    //                      CUSTOM ERRORS
    // ────────────────────────────────────────────────────────────

    error NotBorrower();
    error NotLender();
    error LoanDoesNotExist();
    error LoanAlreadyFunded();
    error LoanAlreadyActive();
    error LoanNotFunded();
    error LoanNotActive();
    error InvalidPrincipal();
    error InvalidRevenueShare();
    error InvalidRepaymentCap();
    error InvalidDuration();
    error IncorrectFundingAmount();
    error RepaymentMustBePositive();
    error CollateralTooHigh();
    error BorrowerCannotFundOwnLoan();
    error LoanNotMatured();
    error LoanFullyRepaid();
    error NoCollateral();
    error TransferFailed();

    // ────────────────────────────────────────────────────────────
    //                         STRUCTS
    // ────────────────────────────────────────────────────────────

    /**
     * @dev revenueSharePercent is reserved for future integration with off-chain revenue
     *      reporting or oracle-based verification systems. The current implementation
     *      enforces repayment via repaymentCapPercent only; revenueSharePercent does not
     *      affect on-chain repayment logic in this version.
     */
    struct Loan {
        address borrower;             // Who receives the principal
        address lender;               // Who provides the principal
        uint256 principal;            // Original loan amount (wei)
        uint256 revenueSharePercent;  // % of revenue to share (reserved for future oracle use)
        uint256 repaymentCapPercent;  // Max % of principal to repay (e.g. 120 = 120%)
        uint256 totalRepaid;          // Cumulative amount repaid (wei)
        bool funded;                  // Has the loan been funded by a lender?
        bool active;                  // Is the loan currently active?
        uint256 collateralAmount;     // ETH deposited by borrower at creation (wei)
        uint256 startTime;            // Block timestamp when loan was funded
        uint256 duration;             // Loan duration in seconds after funding
    }

    // ────────────────────────────────────────────────────────────
    //                      STATE VARIABLES
    // ────────────────────────────────────────────────────────────

    mapping(uint256 => Loan) public loans;
    uint256 public nextLoanId = 1;

    // ────────────────────────────────────────────────────────────
    //                          EVENTS
    // ────────────────────────────────────────────────────────────

    event LoanCreated(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 principal,
        uint256 revenueSharePercent,
        uint256 repaymentCapPercent,
        uint256 duration,
        uint256 collateralAmount
    );
    event LoanFunded(uint256 indexed loanId, address indexed lender);
    event LoanRepaid(uint256 indexed loanId, uint256 amount);
    event LoanClosed(uint256 indexed loanId);
    event CollateralClaimed(uint256 indexed loanId, address indexed claimer);
    event LoanDefaulted(uint256 indexed loanId);

    // ────────────────────────────────────────────────────────────
    //                        MODIFIERS
    // ────────────────────────────────────────────────────────────

    modifier onlyBorrower(uint256 _loanId) {
        if (loans[_loanId].borrower != msg.sender) revert NotBorrower();
        _;
    }

    modifier onlyLender(uint256 _loanId) {
        if (loans[_loanId].lender != msg.sender) revert NotLender();
        _;
    }

    modifier loanExists(uint256 _loanId) {
        if (_loanId == 0 || _loanId >= nextLoanId) revert LoanDoesNotExist();
        _;
    }

    modifier loanActive(uint256 _loanId) {
        if (!loans[_loanId].active) revert LoanNotActive();
        _;
    }

    modifier loanFunded(uint256 _loanId) {
        if (!loans[_loanId].funded) revert LoanNotFunded();
        _;
    }

    // ────────────────────────────────────────────────────────────
    //                       CONSTRUCTOR
    // ────────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ────────────────────────────────────────────────────────────
    //                     ADMIN FUNCTIONS
    // ────────────────────────────────────────────────────────────

    /**
     * @notice Pauses all state-changing protocol operations.
     * @dev Only callable by the contract owner. Emits {Paused}.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the protocol, resuming normal operations.
     * @dev Only callable by the contract owner. Emits {Unpaused}.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    // ────────────────────────────────────────────────────────────
    //                     CORE FUNCTIONS
    // ────────────────────────────────────────────────────────────

    /**
     * @notice Borrower creates a revenue-based loan request with optional collateral.
     * @dev Collateral is supplied as `msg.value` and must not exceed the requested principal.
     *      The loan is created in an unfunded, inactive state awaiting a lender.
     *      `revenueSharePercent` is stored for future oracle-based revenue enforcement;
     *      current model enforces repayment via cap percentage only.
     * @param _amount               Principal amount requested, in wei.
     * @param _revenueSharePercent  Percentage of revenue to share (must be > 0).
     * @param _repaymentCapPercent  Max repayment as a percentage of principal (must be >= 100).
     * @param _duration             Loan duration in seconds, starting from the moment of funding.
     */
    function createLoan(
        uint256 _amount,
        uint256 _revenueSharePercent,
        uint256 _repaymentCapPercent,
        uint256 _duration
    ) external payable whenNotPaused {
        if (_amount == 0)               revert InvalidPrincipal();
        if (_revenueSharePercent == 0)  revert InvalidRevenueShare();
        if (_repaymentCapPercent < 100) revert InvalidRepaymentCap();
        if (_duration == 0)             revert InvalidDuration();
        if (msg.value > _amount)        revert CollateralTooHigh();

        uint256 loanId = nextLoanId++;
        loans[loanId] = Loan({
            borrower:            msg.sender,
            lender:              address(0),
            principal:           _amount,
            revenueSharePercent: _revenueSharePercent,
            repaymentCapPercent: _repaymentCapPercent,
            totalRepaid:         0,
            funded:              false,
            active:              false,
            collateralAmount:    msg.value,
            startTime:           0,
            duration:            _duration
        });

        emit LoanCreated(
            loanId,
            msg.sender,
            _amount,
            _revenueSharePercent,
            _repaymentCapPercent,
            _duration,
            msg.value
        );
    }

    /**
     * @notice Lender funds an open loan by sending the exact principal amount.
     * @dev Transfers the full principal to the borrower atomically upon funding.
     *      The caller may not be the borrower of the same loan.
     *      Applies checks-effects-interactions to prevent reentrancy.
     * @param _loanId ID of the loan to fund.
     */
    function fundLoan(uint256 _loanId)
        external
        payable
        nonReentrant
        whenNotPaused
        loanExists(_loanId)
    {
        Loan storage loan = loans[_loanId];

        if (loan.funded)                 revert LoanAlreadyFunded();
        if (loan.active)                 revert LoanAlreadyActive();
        if (msg.sender == loan.borrower) revert BorrowerCannotFundOwnLoan();
        if (msg.value != loan.principal) revert IncorrectFundingAmount();

        // Cache borrower address before state mutation
        address borrower = loan.borrower;

        // Effects
        loan.lender    = msg.sender;
        loan.funded    = true;
        loan.active    = true;
        loan.startTime = block.timestamp;

        emit LoanFunded(_loanId, msg.sender);

        // Interaction
        (bool success, ) = borrower.call{value: msg.value}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Borrower repays part or all of the outstanding loan obligation.
     * @dev Repayment is forwarded directly to the lender. When cumulative repayment reaches
     *      or exceeds the cap, the loan is closed and any posted collateral is returned to
     *      the borrower. Applies checks-effects-interactions to prevent reentrancy.
     * @param _loanId ID of the loan to repay.
     */
    function repay(uint256 _loanId)
        external
        payable
        nonReentrant
        whenNotPaused
        loanExists(_loanId)
        onlyBorrower(_loanId)
        loanFunded(_loanId)
        loanActive(_loanId)
    {
        if (msg.value == 0) revert RepaymentMustBePositive();

        Loan storage loan = loans[_loanId];

        // Cache frequently read storage values to avoid repeated SLOADs
        uint256 principal           = loan.principal;
        uint256 repaymentCapPercent = loan.repaymentCapPercent;
        address lender              = loan.lender;
        address borrower            = loan.borrower;

        uint256 requiredRepayment = (principal * repaymentCapPercent) / 100;

        // Effects — update state before external calls
        uint256 newTotalRepaid = loan.totalRepaid + msg.value;
        loan.totalRepaid = newTotalRepaid;

        emit LoanRepaid(_loanId, msg.value);

        // Interaction: forward repayment to lender
        (bool lenderSuccess, ) = lender.call{value: msg.value}("");
        if (!lenderSuccess) revert TransferFailed();

        // Close loan if repayment cap has been reached
        if (newTotalRepaid >= requiredRepayment) {
            loan.active = false;

            uint256 collateral = loan.collateralAmount;
            if (collateral > 0) {
                loan.collateralAmount = 0;
                (bool collateralSuccess, ) = borrower.call{value: collateral}("");
                if (!collateralSuccess) revert TransferFailed();
            }

            emit LoanClosed(_loanId);
        }
    }

    /**
     * @notice Lender claims posted collateral after loan maturity in the event of a default.
     * @dev Can only be invoked after the loan duration has elapsed and the borrower has not
     *      reached the repayment cap. Emits {LoanDefaulted} before {LoanClosed}.
     *      Applies checks-effects-interactions to prevent reentrancy.
     * @param _loanId ID of the defaulted loan.
     */
    function claimCollateral(uint256 _loanId)
        external
        nonReentrant
        whenNotPaused
        loanExists(_loanId)
        onlyLender(_loanId)
        loanFunded(_loanId)
        loanActive(_loanId)
    {
        Loan storage loan = loans[_loanId];

        // Cache storage reads to avoid repeated SLOADs
        uint256 startTime           = loan.startTime;
        uint256 duration            = loan.duration;
        uint256 principal           = loan.principal;
        uint256 repaymentCapPercent = loan.repaymentCapPercent;
        uint256 totalRepaid         = loan.totalRepaid;
        address lender              = loan.lender;

        if (block.timestamp <= startTime + duration) revert LoanNotMatured();

        uint256 requiredRepayment = (principal * repaymentCapPercent) / 100;
        if (totalRepaid >= requiredRepayment) revert LoanFullyRepaid();

        uint256 collateral = loan.collateralAmount;
        if (collateral == 0) revert NoCollateral();

        // Effects — zero out state before interaction
        loan.active           = false;
        loan.collateralAmount = 0;

        // LoanDefaulted must emit BEFORE LoanClosed
        emit LoanDefaulted(_loanId);
        emit CollateralClaimed(_loanId, msg.sender);
        emit LoanClosed(_loanId);

        // Interaction
        (bool success, ) = lender.call{value: collateral}("");
        if (!success) revert TransferFailed();
    }

    // ────────────────────────────────────────────────────────────
    //                      VIEW FUNCTIONS
    // ────────────────────────────────────────────────────────────

    /**
     * @notice Returns the full on-chain state of a loan by its ID.
     * @dev Reverts with {LoanDoesNotExist} if the ID is out of range.
     * @param _loanId ID of the loan to query.
     * @return A `Loan` memory struct containing all loan parameters and current state.
     */
    function getLoan(uint256 _loanId)
        external
        view
        loanExists(_loanId)
        returns (Loan memory)
    {
        return loans[_loanId];
    }
}