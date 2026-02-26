const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RevenueLoan", function () {
  let RevenueLoan;
  let revenueLoan;
  let owner, borrower, lender, other;

  const PRINCIPAL = ethers.utils.parseEther("10");
  const REVENUE_SHARE = 10; // 10%
  const REPAYMENT_CAP = 120; // 120%
  const DURATION = 7 * 24 * 60 * 60; // 7 days
  const COLLATERAL = ethers.utils.parseEther("2");

  beforeEach(async function () {
    [owner, borrower, lender, other] = await ethers.getSigners();
    RevenueLoan = await ethers.getContractFactory("RevenueLoan");
    revenueLoan = await RevenueLoan.deploy();
    await revenueLoan.deployed();
  });

  describe("Loan Creation", function () {
    it("Should create a loan with collateral", async function () {
      await expect(
        revenueLoan.connect(borrower).createLoan(
          PRINCIPAL,
          REVENUE_SHARE,
          REPAYMENT_CAP,
          DURATION,
          { value: COLLATERAL }
        )
      )
        .to.emit(revenueLoan, "LoanCreated")
        .withArgs(
          1,
          borrower.address,
          PRINCIPAL,
          REVENUE_SHARE,
          REPAYMENT_CAP,
          DURATION,
          COLLATERAL
        );

      const loan = await revenueLoan.loans(1);
      expect(loan.borrower).to.equal(borrower.address);
      expect(loan.lender).to.equal(ethers.constants.AddressZero);
      expect(loan.principal).to.equal(PRINCIPAL);
      expect(loan.revenueSharePercent).to.equal(REVENUE_SHARE);
      expect(loan.repaymentCapPercent).to.equal(REPAYMENT_CAP);
      expect(loan.totalRepaid).to.equal(0);
      expect(loan.funded).to.be.false;
      expect(loan.active).to.be.false;
      expect(loan.collateralAmount).to.equal(COLLATERAL);
      expect(loan.startTime).to.equal(0);
      expect(loan.duration).to.equal(DURATION);
    });

    it("Should create a loan without collateral", async function () {
      await revenueLoan.connect(borrower).createLoan(
        PRINCIPAL,
        REVENUE_SHARE,
        REPAYMENT_CAP,
        DURATION
      );
      const loan = await revenueLoan.loans(1);
      expect(loan.collateralAmount).to.equal(0);
    });

    it("Should revert if principal is 0", async function () {
      await expect(
        revenueLoan.connect(borrower).createLoan(0, REVENUE_SHARE, REPAYMENT_CAP, DURATION)
      ).to.be.revertedWith("Principal must be > 0");
    });

    it("Should revert if revenueSharePercent is 0", async function () {
      await expect(
        revenueLoan.connect(borrower).createLoan(PRINCIPAL, 0, REPAYMENT_CAP, DURATION)
      ).to.be.revertedWith("Revenue share % must be > 0");
    });

    it("Should revert if repaymentCapPercent < 100", async function () {
      await expect(
        revenueLoan.connect(borrower).createLoan(PRINCIPAL, REVENUE_SHARE, 99, DURATION)
      ).to.be.revertedWith("Repayment cap must be >=100%");
    });

    it("Should revert if duration is 0", async function () {
      await expect(
        revenueLoan.connect(borrower).createLoan(PRINCIPAL, REVENUE_SHARE, REPAYMENT_CAP, 0)
      ).to.be.revertedWith("Duration must be > 0");
    });
  });

  describe("Loan Funding", function () {
    beforeEach(async function () {
      await revenueLoan.connect(borrower).createLoan(
        PRINCIPAL,
        REVENUE_SHARE,
        REPAYMENT_CAP,
        DURATION,
        { value: COLLATERAL }
      );
    });

    it("Should fund a loan and transfer principal to borrower", async function () {
      const borrowerBalanceBefore = await ethers.provider.getBalance(borrower.address);

      await expect(
        revenueLoan.connect(lender).fundLoan(1, { value: PRINCIPAL })
      )
        .to.emit(revenueLoan, "LoanFunded")
        .withArgs(1, lender.address);

      const borrowerBalanceAfter = await ethers.provider.getBalance(borrower.address);
      expect(borrowerBalanceAfter.sub(borrowerBalanceBefore)).to.equal(PRINCIPAL);

      const loan = await revenueLoan.loans(1);
      expect(loan.lender).to.equal(lender.address);
      expect(loan.funded).to.be.true;
      expect(loan.active).to.be.true;
      expect(loan.startTime).to.be.gt(0);
    });

    it("Should revert if loan already funded", async function () {
      await revenueLoan.connect(lender).fundLoan(1, { value: PRINCIPAL });
      await expect(
        revenueLoan.connect(lender).fundLoan(1, { value: PRINCIPAL })
      ).to.be.revertedWith("Loan already funded");
    });

    it("Should revert if incorrect principal sent", async function () {
      await expect(
        revenueLoan.connect(lender).fundLoan(1, { value: ethers.utils.parseEther("5") })
      ).to.be.revertedWith("Incorrect principal amount");
    });

    it("Should revert if loan does not exist", async function () {
      await expect(
        revenueLoan.connect(lender).fundLoan(99, { value: PRINCIPAL })
      ).to.be.revertedWith("Loan does not exist");
    });
  });

  describe("Repayment", function () {
    beforeEach(async function () {
      await revenueLoan.connect(borrower).createLoan(
        PRINCIPAL,
        REVENUE_SHARE,
        REPAYMENT_CAP,
        DURATION,
        { value: COLLATERAL }
      );
      await revenueLoan.connect(lender).fundLoan(1, { value: PRINCIPAL });
    });

    it("Should allow partial repayment", async function () {
      const repaymentAmount = ethers.utils.parseEther("2");
      const lenderBalanceBefore = await ethers.provider.getBalance(lender.address);

      await expect(
        revenueLoan.connect(borrower).repay(1, { value: repaymentAmount })
      )
        .to.emit(revenueLoan, "LoanRepaid")
        .withArgs(1, repaymentAmount);

      const lenderBalanceAfter = await ethers.provider.getBalance(lender.address);
      expect(lenderBalanceAfter.sub(lenderBalanceBefore)).to.equal(repaymentAmount);

      const loan = await revenueLoan.loans(1);
      expect(loan.totalRepaid).to.equal(repaymentAmount);
      expect(loan.active).to.be.true; // still active
    });

    it("Should fully repay and release collateral (zeroed before transfer)", async function () {
      const requiredRepayment = PRINCIPAL.mul(REPAYMENT_CAP).div(100); // 12 ETH
      const borrowerBalanceBefore = await ethers.provider.getBalance(borrower.address);
      const lenderBalanceBefore = await ethers.provider.getBalance(lender.address);

      await expect(
        revenueLoan.connect(borrower).repay(1, { value: requiredRepayment })
      )
        .to.emit(revenueLoan, "LoanRepaid")
        .withArgs(1, requiredRepayment)
        .to.emit(revenueLoan, "LoanClosed")
        .withArgs(1);

      const borrowerBalanceAfter = await ethers.provider.getBalance(borrower.address);
      const lenderBalanceAfter = await ethers.provider.getBalance(lender.address);

      // Borrower gets collateral back (2 ETH) minus what they paid? Actually they paid 12 ETH,
      // but received 10 ETH initially, plus 2 ETH collateral back, net -0? Let's calculate net:
      // Initial: borrower had X, received 10 from funding, now pays 12, gets 2 back => net 0 change.
      // But due to gas, it's slightly less.
      expect(borrowerBalanceAfter.sub(borrowerBalanceBefore)).to.be.closeTo(
        ethers.utils.parseEther("0"),
        ethers.utils.parseEther("0.1") // allow gas
      );
      expect(lenderBalanceAfter.sub(lenderBalanceBefore)).to.equal(requiredRepayment);

      const loan = await revenueLoan.loans(1);
      expect(loan.active).to.be.false;
      expect(loan.totalRepaid).to.equal(requiredRepayment);
      expect(loan.collateralAmount).to.equal(0); // collateral zeroed
    });

    it("Should revert if not borrower", async function () {
      await expect(
        revenueLoan.connect(other).repay(1, { value: PRINCIPAL })
      ).to.be.revertedWith("Not the borrower");
    });

    it("Should revert if loan not funded", async function () {
      // Create another loan without funding
      await revenueLoan.connect(borrower).createLoan(
        PRINCIPAL,
        REVENUE_SHARE,
        REPAYMENT_CAP,
        DURATION
      );
      await expect(
        revenueLoan.connect(borrower).repay(2, { value: PRINCIPAL })
      ).to.be.revertedWith("Loan not funded");
    });

    it("Should revert if loan not active", async function () {
      // Fully repay
      const requiredRepayment = PRINCIPAL.mul(REPAYMENT_CAP).div(100);
      await revenueLoan.connect(borrower).repay(1, { value: requiredRepayment });
      await expect(
        revenueLoan.connect(borrower).repay(1, { value: ethers.utils.parseEther("1") })
      ).to.be.revertedWith("Loan is not active");
    });

    it("Should revert if repayment amount is 0", async function () {
      await expect(
        revenueLoan.connect(borrower).repay(1, { value: 0 })
      ).to.be.revertedWith("Repayment amount must be >0");
    });

    it("Should prevent double collateral release (collateral already zero)", async function () {
      const requiredRepayment = PRINCIPAL.mul(REPAYMENT_CAP).div(100);
      await revenueLoan.connect(borrower).repay(1, { value: requiredRepayment });
      const loan = await revenueLoan.loans(1);
      expect(loan.collateralAmount).to.equal(0);
    });
  });

  describe("Collateral Claim", function () {
    beforeEach(async function () {
      await revenueLoan.connect(borrower).createLoan(
        PRINCIPAL,
        REVENUE_SHARE,
        REPAYMENT_CAP,
        DURATION,
        { value: COLLATERAL }
      );
      await revenueLoan.connect(lender).fundLoan(1, { value: PRINCIPAL });
    });

    it("Should allow lender to claim collateral after default", async function () {
      // Fast forward past duration
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      const lenderBalanceBefore = await ethers.provider.getBalance(lender.address);

      await expect(
        revenueLoan.connect(lender).claimCollateral(1)
      )
        .to.emit(revenueLoan, "CollateralClaimed")
        .withArgs(1, lender.address)
        .to.emit(revenueLoan, "LoanClosed")
        .withArgs(1);

      const lenderBalanceAfter = await ethers.provider.getBalance(lender.address);
      expect(lenderBalanceAfter.sub(lenderBalanceBefore)).to.equal(COLLATERAL);

      const loan = await revenueLoan.loans(1);
      expect(loan.active).to.be.false;
      expect(loan.collateralAmount).to.equal(0);
    });

    it("Should revert if loan not matured", async function () {
      await expect(
        revenueLoan.connect(lender).claimCollateral(1)
      ).to.be.revertedWith("Loan not yet matured");
    });

    it("Should revert if loan is fully repaid", async function () {
      const requiredRepayment = PRINCIPAL.mul(REPAYMENT_CAP).div(100);
      await revenueLoan.connect(borrower).repay(1, { value: requiredRepayment });

      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        revenueLoan.connect(lender).claimCollateral(1)
      ).to.be.revertedWith("Loan is fully repaid");
    });

    it("Should revert if not lender", async function () {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        revenueLoan.connect(other).claimCollateral(1)
      ).to.be.revertedWith("Not the lender");
    });

    it("Should revert if loan not funded", async function () {
      // Create a loan without funding
      await revenueLoan.connect(borrower).createLoan(
        PRINCIPAL,
        REVENUE_SHARE,
        REPAYMENT_CAP,
        DURATION,
        { value: COLLATERAL }
      );
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        revenueLoan.connect(lender).claimCollateral(2)
      ).to.be.revertedWith("Loan not funded");
    });

    it("Should revert if loan already inactive", async function () {
      const requiredRepayment = PRINCIPAL.mul(REPAYMENT_CAP).div(100);
      await revenueLoan.connect(borrower).repay(1, { value: requiredRepayment });

      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        revenueLoan.connect(lender).claimCollateral(1)
      ).to.be.revertedWith("Loan is not active");
    });

    it("Should revert if no collateral", async function () {
      // Create loan without collateral
      await revenueLoan.connect(borrower).createLoan(
        PRINCIPAL,
        REVENUE_SHARE,
        REPAYMENT_CAP,
        DURATION
      );
      await revenueLoan.connect(lender).fundLoan(2, { value: PRINCIPAL });

      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        revenueLoan.connect(lender).claimCollateral(2)
      ).to.be.revertedWith("No collateral to claim");
    });

    it("Should prevent double claim (collateral already zero)", async function () {
      await ethers.provider.send("evm_increaseTime", [DURATION + 1]);
      await ethers.provider.send("evm_mine", []);

      await revenueLoan.connect(lender).claimCollateral(1);

      // Attempt to claim again
      await expect(
        revenueLoan.connect(lender).claimCollateral(1)
      ).to.be.revertedWith("Loan is not active");
    });
  });
});