// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RevenueLoan
 * @dev Revenue-based lending protocol with optional collateral.
 *      Upgraded with security best practices: collateral zeroed before transfer,
 *      explicit funded checks, and reentrancy protection.
 */
contract RevenueLoan is ReentrancyGuard {
    // -------------------- Structs --------------------
    struct Loan {
        address borrower;              // Who receives the principal
        address lender;                 // Who provides the principal
        uint256 principal;              // Original loan amount
        uint256 revenueSharePercent;    // % of revenue to share (unused in this version)
        uint256 repaymentCapPercent;    // Max % of principal to repay (e.g., 120 = 120%)
        uint256 totalRepaid;            // Total amount already repaid
        bool funded;                     // Has the loan been funded?
        bool active;                      // Is the loan currently active?
        uint256 collateralAmount;        // ETH sent by borrower at creation
        uint256 startTime;                // Timestamp when loan was funded
        uint256 duration;                  // Loan duration in seconds
    }

    // -------------------- State Variables --------------------
    mapping(uint256 => Loan) public loans;
    uint256 public nextLoanId = 1;

    // -------------------- Events --------------------
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

    // -------------------- Modifiers --------------------
    modifier onlyBorrower(uint256 _loanId) {
        require(loans[_loanId].borrower == msg.sender, "Not the borrower");
        _;
    }

    modifier onlyLender(uint256 _loanId) {
        require(loans[_loanId].lender == msg.sender, "Not the lender");
        _;
    }

    modifier loanExists(uint256 _loanId) {
        require(_loanId > 0 && _loanId < nextLoanId, "Loan does not exist");
        _;
    }

    modifier loanActive(uint256 _loanId) {
        require(loans[_loanId].active, "Loan is not active");
        _;
    }

    modifier loanFunded(uint256 _loanId) {
        require(loans[_loanId].funded, "Loan not funded");
        _;
    }

    // -------------------- Core Functions --------------------

    /**
     * @notice Borrower creates a loan.
     * @param _amount Principal amount requested (in wei)
     * @param _revenueSharePercent Percentage of revenue to share (unused, stored for future)
     * @param _repaymentCapPercent Max percentage of principal to repay (>=100)
     * @param _duration Loan duration in seconds
     * @dev Collateral is sent as msg.value (can be 0)
     */
    function createLoan(
        uint256 _amount,
        uint256 _revenueSharePercent,
        uint256 _repaymentCapPercent,
        uint256 _duration
    ) external payable {
        require(_amount > 0, "Principal must be > 0");
        require(_revenueSharePercent > 0, "Revenue share % must be > 0");
        require(_repaymentCapPercent >= 100, "Repayment cap must be >=100%");
        require(_duration > 0, "Duration must be > 0");

        uint256 loanId = nextLoanId++;
        loans[loanId] = Loan({
            borrower: msg.sender,
            lender: address(0),
            principal: _amount,
            revenueSharePercent: _revenueSharePercent,
            repaymentCapPercent: _repaymentCapPercent,
            totalRepaid: 0,
            funded: false,
            active: false,
            collateralAmount: msg.value,
            startTime: 0,
            duration: _duration
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
     * @notice Lender funds a loan. Sends exact principal to borrower.
     * @param _loanId ID of the loan
     */
    function fundLoan(uint256 _loanId)
        external
        payable
        nonReentrant
        loanExists(_loanId)
    {
        Loan storage loan = loans[_loanId];
        require(!loan.funded, "Loan already funded");
        require(msg.value == loan.principal, "Incorrect principal amount");

        // Transfer principal to borrower
        (bool success, ) = loan.borrower.call{value: msg.value}("");
        require(success, "Transfer to borrower failed");

        loan.lender = msg.sender;
        loan.funded = true;
        loan.active = true;
        loan.startTime = block.timestamp;

        emit LoanFunded(_loanId, msg.sender);
    }

    /**
     * @notice Borrower repays part or all of the loan.
     * @param _loanId ID of the loan
     */
    function repay(uint256 _loanId)
        external
        payable
        nonReentrant
        loanExists(_loanId)
        onlyBorrower(_loanId)
        loanFunded(_loanId)
        loanActive(_loanId)
    {
        Loan storage loan = loans[_loanId];
        require(msg.value > 0, "Repayment amount must be >0");

        uint256 requiredRepayment = (loan.principal * loan.repaymentCapPercent) / 100;

        // Transfer payment to lender
        (bool success, ) = loan.lender.call{value: msg.value}("");
        require(success, "Transfer to lender failed");

        loan.totalRepaid += msg.value;
        emit LoanRepaid(_loanId, msg.value);

        // Check if loan is fully repaid
        if (loan.totalRepaid >= requiredRepayment) {
            loan.active = false;

            // Return collateral to borrower if any (zero it before transfer)
            if (loan.collateralAmount > 0) {
                uint256 collateral = loan.collateralAmount;
                loan.collateralAmount = 0;
                (bool collateralSuccess, ) = loan.borrower.call{value: collateral}("");
                require(collateralSuccess, "Collateral return failed");
            }

            emit LoanClosed(_loanId);
        }
    }

    /**
     * @notice Lender claims collateral in case of default.
     * @param _loanId ID of the loan
     */
    function claimCollateral(uint256 _loanId)
        external
        nonReentrant
        loanExists(_loanId)
        onlyLender(_loanId)
        loanFunded(_loanId)
        loanActive(_loanId)
    {
        Loan storage loan = loans[_loanId];
        require(block.timestamp > loan.startTime + loan.duration, "Loan not yet matured");

        uint256 requiredRepayment = (loan.principal * loan.repaymentCapPercent) / 100;
        require(loan.totalRepaid < requiredRepayment, "Loan is fully repaid");

        uint256 collateral = loan.collateralAmount;
        require(collateral > 0, "No collateral to claim");

        // Zero out before transfer (checks-effects-interactions)
        loan.active = false;
        loan.collateralAmount = 0;

        (bool success, ) = loan.lender.call{value: collateral}("");
        require(success, "Collateral transfer failed");

        emit CollateralClaimed(_loanId, msg.sender);
        emit LoanClosed(_loanId);
    }

    // -------------------- View Functions --------------------
    function getLoan(uint256 _loanId) external view returns (Loan memory) {
        require(_loanId > 0 && _loanId < nextLoanId, "Loan does not exist");
        return loans[_loanId];
    }
}