// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title SnakeArenaPariMutuel
 * @notice Pari-mutuel betting pool for Snake Arena (USDC version)
 * @dev 10% platform rake, 90% to bettors. Uses USDC (6 decimals) on Base Sepolia.
 */
contract SnakeArenaPariMutuel is Ownable, ReentrancyGuard, Pausable {

    // ============ Constants ============
    uint256 public constant PERCENTAGE_BASE = 10000; // 100% = 10000 basis points

    // Prize distribution for TOP 3 bettors (50%, 30%, 20% of 90% = 45%, 27%, 18%)
    uint256 public constant FIRST_PLACE_SHARE = 5000;  // 50%
    uint256 public constant SECOND_PLACE_SHARE = 3000; // 30%
    uint256 public constant THIRD_PLACE_SHARE = 2000;  // 20%

    // Platform rake: 10% (covers platform + bot designer rewards)
    uint256 public constant PLATFORM_RAKE = 1000;     // 10%
    uint256 public constant TOTAL_RAKE = 1000;        // 10%

    // ============ State Variables ============

    IERC20 public usdc;

    // ============ Structs ============

    struct Bet {
        address bettor;
        bytes32 botId;
        uint256 amount;
        bool claimed;
    }

    struct Match {
        uint256 matchId;
        uint256 startTime;
        uint256 endTime;
        uint256 totalPool;
        bool settled;
        bool cancelled;
        bytes32[] winners;  // 1st, 2nd, 3rd place bot IDs
        uint256[] winnerPools;
    }

    // ============ Mappings ============

    mapping(uint256 => Match) public matches;
    mapping(uint256 => Bet[]) public matchBets;
    mapping(uint256 => mapping(bytes32 => uint256)) public botTotalBets;
    mapping(uint256 => mapping(address => mapping(bytes32 => uint256[]))) public bettorBotBets;
    mapping(uint256 => mapping(address => uint256)) public bettorTotalBet;

    mapping(address => bool) public authorizedOracles;

    // Track platform fees separately to avoid withdrawing bettor funds
    uint256 public accumulatedPlatformFees;

    // ============ Events ============

    event BetPlaced(
        uint256 indexed matchId,
        address indexed bettor,
        bytes32 indexed botId,
        uint256 amount,
        uint256 betIndex
    );

    event MatchCreated(uint256 indexed matchId, uint256 startTime);

    event MatchSettled(
        uint256 indexed matchId,
        bytes32[] winners,
        uint256 totalPool,
        uint256 platformRake,
        uint256 botRewards
    );

    event MatchCancelled(uint256 indexed matchId, string reason);
    event WinningsClaimed(uint256 indexed matchId, address indexed bettor, uint256 amount);
    event RefundClaimed(uint256 indexed matchId, address indexed bettor, uint256 amount);
    event OracleAuthorized(address oracle);
    event OracleRevoked(address oracle);
    event PlatformFeesWithdrawn(uint256 amount);

    // ============ Modifiers ============

    modifier onlyOracle() {
        require(authorizedOracles[msg.sender], "Not authorized oracle");
        _;
    }

    modifier matchExists(uint256 _matchId) {
        require(matches[_matchId].matchId != 0, "Match does not exist");
        _;
    }

    modifier matchNotSettled(uint256 _matchId) {
        require(!matches[_matchId].settled, "Match already settled");
        require(!matches[_matchId].cancelled, "Match cancelled");
        _;
    }

    // ============ Constructor ============

    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }

    // ============ Core Functions ============

    /**
     * @notice Place a bet using USDC. Caller must approve this contract first.
     * @param _matchId The match to bet on
     * @param _botId The bot to bet on (bytes32)
     * @param _amount Amount of USDC (6 decimals) to bet
     */
    function placeBet(uint256 _matchId, bytes32 _botId, uint256 _amount)
        external
        nonReentrant
        whenNotPaused
        matchExists(_matchId)
        matchNotSettled(_matchId)
    {
        require(_amount > 0, "Bet amount must be > 0");
        require(_botId != bytes32(0), "Invalid bot ID");
        require(block.timestamp < matches[_matchId].startTime + 5 minutes, "Betting closed");

        // Transfer USDC from bettor to this contract
        require(usdc.transferFrom(msg.sender, address(this), _amount), "USDC transfer failed");

        Bet memory newBet = Bet({
            bettor: msg.sender,
            botId: _botId,
            amount: _amount,
            claimed: false
        });

        uint256 betIndex = matchBets[_matchId].length;
        matchBets[_matchId].push(newBet);

        botTotalBets[_matchId][_botId] += _amount;
        bettorTotalBet[_matchId][msg.sender] += _amount;
        bettorBotBets[_matchId][msg.sender][_botId].push(betIndex);
        matches[_matchId].totalPool += _amount;

        emit BetPlaced(_matchId, msg.sender, _botId, _amount, betIndex);
    }

    function createMatch(uint256 _matchId, uint256 _startTime)
        external
        onlyOracle
    {
        require(matches[_matchId].matchId == 0, "Match already exists");
        require(_startTime > block.timestamp, "Start time must be in future");

        matches[_matchId] = Match({
            matchId: _matchId,
            startTime: _startTime,
            endTime: 0,
            totalPool: 0,
            settled: false,
            cancelled: false,
            winners: new bytes32[](0),
            winnerPools: new uint256[](0)
        });

        emit MatchCreated(_matchId, _startTime);
    }

    function settleMatch(
        uint256 _matchId,
        bytes32[] calldata _winners
    )
        external
        nonReentrant
        onlyOracle
        matchExists(_matchId)
        matchNotSettled(_matchId)
    {
        require(_winners.length > 0 && _winners.length <= 3, "Need 1-3 winners");
        require(block.timestamp >= matches[_matchId].startTime, "Match not started");

        Match storage matchData = matches[_matchId];
        matchData.settled = true;
        matchData.endTime = block.timestamp;
        matchData.winners = _winners;

        uint256 totalPool = matchData.totalPool;
        uint256 platformRake = 0;

        if (totalPool > 0) {
            // Platform rake: 10% (covers platform + bot designer rewards)
            platformRake = (totalPool * PLATFORM_RAKE) / PERCENTAGE_BASE;
            accumulatedPlatformFees += platformRake;

            // Store winner pool amounts for bettor payout calculation
            uint256[] memory winnerPools = new uint256[](_winners.length);
            for (uint i = 0; i < _winners.length; i++) {
                winnerPools[i] = botTotalBets[_matchId][_winners[i]];
            }
            matchData.winnerPools = winnerPools;
        }

        emit MatchSettled(_matchId, _winners, totalPool, platformRake, 0);
    }

    function cancelMatch(uint256 _matchId, string calldata _reason)
        external
        onlyOracle
        matchExists(_matchId)
        matchNotSettled(_matchId)
    {
        matches[_matchId].cancelled = true;
        emit MatchCancelled(_matchId, _reason);
    }

    function claimWinnings(uint256 _matchId)
        external
        nonReentrant
        matchExists(_matchId)
    {
        Match storage matchData = matches[_matchId];
        require(matchData.settled, "Match not settled");

        uint256 totalWinnings = 0;
        Bet[] storage bets = matchBets[_matchId];

        for (uint i = 0; i < bets.length; i++) {
            if (bets[i].bettor == msg.sender && !bets[i].claimed) {
                uint256 winnings = calculateBetWinnings(_matchId, i);
                if (winnings > 0) {
                    totalWinnings += winnings;
                    bets[i].claimed = true;
                }
            }
        }

        require(totalWinnings > 0, "No winnings to claim");

        require(usdc.transfer(msg.sender, totalWinnings), "USDC transfer failed");

        emit WinningsClaimed(_matchId, msg.sender, totalWinnings);
    }

    function claimRefund(uint256 _matchId)
        external
        nonReentrant
        matchExists(_matchId)
    {
        require(matches[_matchId].cancelled, "Match not cancelled");

        uint256 refundAmount = 0;
        Bet[] storage bets = matchBets[_matchId];

        for (uint i = 0; i < bets.length; i++) {
            if (bets[i].bettor == msg.sender && !bets[i].claimed) {
                refundAmount += bets[i].amount;
                bets[i].claimed = true;
            }
        }

        require(refundAmount > 0, "No refund available");

        require(usdc.transfer(msg.sender, refundAmount), "Refund failed");

        emit RefundClaimed(_matchId, msg.sender, refundAmount);
    }

    // ============ View Functions ============

    function calculateBetWinnings(uint256 _matchId, uint256 _betIndex)
        public
        view
        returns (uint256)
    {
        Bet storage bet = matchBets[_matchId][_betIndex];
        Match storage matchData = matches[_matchId];

        if (!matchData.settled || bet.claimed) {
            return 0;
        }

        uint256 place = 0;
        for (uint i = 0; i < matchData.winners.length; i++) {
            if (matchData.winners[i] == bet.botId) {
                place = i + 1;
                break;
            }
        }

        if (place == 0) {
            return 0;
        }

        uint256 totalPool = matchData.totalPool;
        // 90% to bettors (100% - 10% platform rake)
        uint256 payoutPool = (totalPool * (PERCENTAGE_BASE - TOTAL_RAKE)) / PERCENTAGE_BASE;

        uint256 prizeShare;
        if (place == 1) {
            prizeShare = FIRST_PLACE_SHARE;
        } else if (place == 2) {
            prizeShare = SECOND_PLACE_SHARE;
        } else if (place == 3) {
            prizeShare = THIRD_PLACE_SHARE;
        } else {
            return 0;
        }

        uint256 botPrizePool = (payoutPool * prizeShare) / PERCENTAGE_BASE;
        uint256 totalBetOnBot = botTotalBets[_matchId][bet.botId];

        if (totalBetOnBot == 0) {
            return 0;
        }

        uint256 winnings = (bet.amount * botPrizePool) / totalBetOnBot;
        return winnings;
    }

    function getUserPotentialWinnings(uint256 _matchId, address _bettor)
        external
        view
        returns (uint256)
    {
        uint256 total = 0;
        Bet[] storage bets = matchBets[_matchId];

        for (uint i = 0; i < bets.length; i++) {
            if (bets[i].bettor == _bettor) {
                total += calculateBetWinnings(_matchId, i);
            }
        }

        return total;
    }

    function getMatchBets(uint256 _matchId)
        external
        view
        returns (Bet[] memory)
    {
        return matchBets[_matchId];
    }

    function getCurrentOdds(uint256 _matchId, bytes32 _botId)
        external
        view
        returns (uint256)
    {
        uint256 totalPool = matches[_matchId].totalPool;
        uint256 botBets = botTotalBets[_matchId][_botId];

        if (botBets == 0 || totalPool == 0) {
            return 0;
        }

        // 90% payout to bettors
        uint256 payoutPool = (totalPool * (PERCENTAGE_BASE - TOTAL_RAKE)) / PERCENTAGE_BASE;
        return (payoutPool * PERCENTAGE_BASE) / botBets;
    }

    // ============ Admin Functions ============

    function authorizeOracle(address _oracle) external onlyOwner {
        authorizedOracles[_oracle] = true;
        emit OracleAuthorized(_oracle);
    }

    function revokeOracle(address _oracle) external onlyOwner {
        authorizedOracles[_oracle] = false;
        emit OracleRevoked(_oracle);
    }

    function withdrawPlatformFees() external onlyOwner {
        uint256 amount = accumulatedPlatformFees;
        require(amount > 0, "No platform fees");

        accumulatedPlatformFees = 0;

        require(usdc.transfer(owner(), amount), "Withdraw failed");

        emit PlatformFeesWithdrawn(amount);
    }

    function setUsdc(address _usdc) external onlyOwner {
        usdc = IERC20(_usdc);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function emergencyWithdraw() external onlyOwner whenPaused {
        uint256 balance = usdc.balanceOf(address(this));
        require(balance > 0, "No USDC balance");
        require(usdc.transfer(owner(), balance), "Withdrawal failed");
    }
}
