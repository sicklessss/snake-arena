// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SnakeArenaBetting {
    address public owner;
    uint256 public feePercentage = 10; // 10% fee for the house

    struct Bet {
        address bettor;
        uint256 amount;
        string botId;
    }

    // matchId => (botId => totalBetAmount)
    mapping(uint256 => mapping(string => uint256)) public matchBotTotalBets;
    // matchId => totalPoolAmount
    mapping(uint256 => uint256) public matchTotalPool;
    // matchId => list of all bets
    mapping(uint256 => Bet[]) public matchBets;
    
    // matchId => isSettled
    mapping(uint256 => bool) public matchSettled;

    event BetPlaced(uint256 indexed matchId, address indexed bettor, string botId, uint256 amount);
    event Payout(uint256 indexed matchId, string winnerBotId, uint256 totalPool, uint256 winnerPool);
    event FeesCollected(uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function placeBet(uint256 matchId, string memory botId) external payable {
        require(msg.value > 0, "Bet amount must be > 0");
        require(!matchSettled[matchId], "Match already settled");

        matchBets[matchId].push(Bet({
            bettor: msg.sender,
            amount: msg.value,
            botId: botId
        }));

        matchBotTotalBets[matchId][botId] += msg.value;
        matchTotalPool[matchId] += msg.value;

        emit BetPlaced(matchId, msg.sender, botId, msg.value);
    }

    function payout(uint256 matchId, string memory winnerBotId) external onlyOwner {
        require(!matchSettled[matchId], "Already settled");
        require(matchTotalPool[matchId] > 0, "No bets for this match");

        uint256 totalPool = matchTotalPool[matchId];
        uint256 winnerPool = matchBotTotalBets[matchId][winnerBotId];

        // Fee calculation
        uint256 fee = (totalPool * feePercentage) / 100;
        uint256 payoutPool = totalPool - fee;

        if (winnerPool > 0) {
            // Distribute to winners proportionally
            Bet[] storage bets = matchBets[matchId];
            for (uint i = 0; i < bets.length; i++) {
                if (keccak256(bytes(bets[i].botId)) == keccak256(bytes(winnerBotId))) {
                    // Share = (UserBet / WinnerPool) * PayoutPool
                    uint256 share = (bets[i].amount * payoutPool) / winnerPool;
                    payable(bets[i].bettor).transfer(share);
                }
            }
        } else {
            // No one bet on the winner, house takes all (or refund logic could go here)
            fee = totalPool; 
        }

        matchSettled[matchId] = true;
        emit Payout(matchId, winnerBotId, totalPool, winnerPool);
    }

    function withdrawFees() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
    
    // Fallback
    receive() external payable {}
}
