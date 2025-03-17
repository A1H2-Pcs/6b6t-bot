const fs = require("fs");
const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const Vec3 = require('vec3');
const readline = require('readline'); // For terminal input

let bot;
let killTimeoutId = null; // To store the timeout ID for the kill command

// Load and validate config
const config = (() => {
  try {
    const conf = JSON.parse(fs.readFileSync("./config.json", "utf-8"));
    if (!conf.email) throw new Error("Email not configured in config.json");
    return conf;
  } catch (err) {
    console.error("Config error:", err);
    process.exit(1);
  }
})();

// Error handling
process.on('warning', e => console.warn(e.stack));
process.on('uncaughtException', e => {
  console.error('Uncaught Exception:', e);
  logMessageToFile(`Uncaught Exception: ${e}`);
});

// Logging setup
const logFilePath = "./bot_log.txt";
const coordsLogFilePath = "./player_coords.txt"; // New log file for player coordinates
const botCoordsLogFilePath = "./bot_coords.txt"; // New log file for bot's coordinates

const logMessageToFile = (message) => {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  fs.appendFileSync(logFilePath, `${timestamp}: ${message}\n`, "utf-8");
};

// New function to log player coordinates
const logPlayerCoords = (username, coords) => {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  fs.appendFileSync(coordsLogFilePath, 
    `${timestamp}: Player: ${username}, Coords: X=${coords.x.toFixed(2)}, Y=${coords.y.toFixed(2)}, Z=${coords.z.toFixed(2)}\n`, 
    "utf-8");
};

// New function to log bot's coordinates
const logBotCoords = () => {
  if (bot && bot.entity) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const coords = bot.entity.position;
    fs.appendFileSync(botCoordsLogFilePath, 
      `${timestamp}: Bot Coords: X=${coords.x.toFixed(2)}, Y=${coords.y.toFixed(2)}, Z=${coords.z.toFixed(2)}\n`, 
      "utf-8");
  }
};

// Set interval to log bot's coordinates every 10 seconds
setInterval(logBotCoords, 10000);

// Kit configuration
const kitConfig = {
  "Gapples": { 
    coords: { x: -603985, y: 306, z: -462611 }
  },
  "pvp": { 
    coords: { x: -603983, y: 306, z: -462613 }
  },
  "cpvp": { 
    coords: { x: -603983, y: 306, z: -462613 }
  },
  "totem": { 
    coords: { x: -603982, y: 306, z: -462611 }
  },
  "redstone": { 
    coords: { x: -603980, y: 306, z: -462613 }
  },
  "SlokoSloppy": { 
    coords: { x: -603979, y: 306, z: -462611 }
  },
  "Shulker": { 
    coords: { x: -603977, y: 306, z: -462613 }
  },
  "Crystal": { 
    coords: { x: -603976, y: 306, z: -462611 }
  },
  "Dye": { 
    coords: { x: -603974, y: 306, z: -462613 }
  }
};

const requestQueue = [];
let isProcessing = false;
const BUTTON_WAIT_TIME = 2000; // 2 seconds to wait after pressing button
const KILL_DELAY = 60000; // 60 seconds delay before /kill

// Command proxy configuration
const PROXY_ADMIN = config.adminUsername || "your_minecraft_username"; // Set your admin username in config
const PROXY_PREFIX = "%say "; // Prefix for proxy commands

// Terminal interface setup
let rl;
function setupTerminalInterface() {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'Bot Command > '
  });

  // Display help message on startup
  console.log('\n===== Minecraft Bot Terminal Interface =====');
  console.log('Available commands:');
  console.log('  say <message>     - Send a chat message');
  console.log('  cmd <command>     - Execute a command (without the / prefix)');
  console.log('  status            - Show bot status and queue');
  console.log('  help              - Show this help message');
  console.log('  exit              - Exit the bot');
  console.log('=========================================\n');

  rl.prompt();

  rl.on('line', (line) => {
    const input = line.trim();
    
    if (input === 'help') {
      console.log('Available commands:');
      console.log('  say <message>     - Send a chat message');
      console.log('  cmd <command>     - Execute a command (without the / prefix)');
      console.log('  status            - Show bot status and queue');
      console.log('  help              - Show this help message');
      console.log('  exit              - Exit the bot');
    } 
    else if (input === 'exit') {
      console.log('Shutting down bot...');
      if (bot) bot.end();
      rl.close();
      process.exit(0);
    }
    else if (input === 'status') {
      console.log(`Bot status: ${isProcessing ? 'Processing request' : 'Idle'}`);
      console.log(`Queue length: ${requestQueue.length}`);
      if (requestQueue.length > 0) {
        console.log('Pending requests:');
        requestQueue.forEach((req, i) => {
          console.log(`  ${i+1}. ${req.player} - ${req.kit} kit (requested at ${new Date(req.timestamp).toLocaleTimeString()})`);
        });
      }
    }
    else if (input.startsWith('say ')) {
      const message = input.slice(4);
      if (bot && bot.entity) {
        bot.chat(message);
        console.log(`Message sent: ${message}`);
        logMessageToFile(`Terminal sent message: ${message}`);
      } else {
        console.log('Bot is not connected yet.');
      }
    }
    else if (input.startsWith('cmd ')) {
      const command = input.slice(4);
      if (bot && bot.entity) {
        bot.chat(`/${command}`);
        console.log(`Command executed: /${command}`);
        logMessageToFile(`Terminal executed command: /${command}`);
      } else {
        console.log('Bot is not connected yet.');
      }
    }
    else if (input) {
      console.log('Unknown command. Type "help" for available commands.');
    }
    
    rl.prompt();
  }).on('close', () => {
    console.log('Terminal interface closed.');
    if (bot) bot.end();
    process.exit(0);
  });
}

const createBot = () => {
  bot = mineflayer.createBot({
    host: "anarchy.6b6t.org",
    username: config.email,
    auth: 'microsoft',
    version: "1.19.4",
    skipValidation: true,
    chatLengthLimit: 256
  });

  bot.loadPlugin(pathfinder);

  // Spawn handler
  bot.once("spawn", () => {
    console.log("Bot spawned successfully!");
    logMessageToFile("Bot spawned successfully!");
    
    setupMovements();
    setInterval(checkQueue, 5000);
  });

  // Death handler - immediately process next request and clear kill timeout
  bot.on('death', () => {
    console.log('Bot died, respawning...');
    logMessageToFile('Bot died, respawning...');
    
    // Clear the kill timeout if it exists
    if (killTimeoutId) {
      clearTimeout(killTimeoutId);
      killTimeoutId = null;
      logMessageToFile('Canceled scheduled /kill command due to natural death');
    }
    
    isProcessing = false;
  });

  // Handle successful teleportation
  bot.on('forcedMove', () => {
    // Check if we're processing a request and have teleported to a player
    if (isProcessing && requestQueue.length > 0) {
      const playerPosition = bot.entity.position;
      const currentPlayer = requestQueue[0]?.player;
      
      if (currentPlayer) {
        // Log the coordinates
        logMessageToFile(`Teleported to ${currentPlayer} at X=${playerPosition.x.toFixed(2)}, Y=${playerPosition.y.toFixed(2)}, Z=${playerPosition.z.toFixed(2)}`);
        logPlayerCoords(currentPlayer, playerPosition);
      }
    }
  });

  // Chat handler for TPA requests
  bot.on("message", (message) => {
    const messageText = message.toString().trim();
    logMessageToFile(`Received message: ${messageText}`);
    console.log(`[Chat] ${messageText}`); // Echo chat messages to terminal
  });

  // Handle direct chat messages (for kit requests and proxy commands)
  bot.on("chat", (username, message) => {
    // Handle kit request
    if (message.toLowerCase().startsWith("%kit ")) {
      handleKitRequest(username, message);
    }
    
    // Handle proxy command - allow admin to speak through the bot
    else if (message.toLowerCase().startsWith(PROXY_PREFIX) && (username === PROXY_ADMIN || config.additionalAdmins?.includes(username))) {
      const proxyMessage = message.slice(PROXY_PREFIX.length).trim();
      if (proxyMessage) {
        // Check if it's a command
        if (proxyMessage.startsWith('/')) {
          bot.chat(proxyMessage);
          logMessageToFile(`Admin ${username} executed command through bot: ${proxyMessage}`);
        } 
        // Regular chat message
        else {
          bot.chat(proxyMessage);
          logMessageToFile(`Admin ${username} spoke through bot: ${proxyMessage}`);
        }
      }
    }
  });

  // Error handlers
  bot.on("error", handleError);
  bot.on("end", handleDisconnect);
};

function setupMovements() {
  const defaultMove = new Movements(bot);
  defaultMove.allowParkour = false;
  defaultMove.canDig = false;
  defaultMove.blocksCantBreak.add(bot.registry.blocksByName.chest.id);
  defaultMove.maxDropDown = 3;
  defaultMove.scafoldingBlocks = [];
  bot.pathfinder.setMovements(defaultMove);
}

function handleKitRequest(username, message) {
  const kitType = message.slice(5).toLowerCase().trim();
  
  if (!kitConfig[kitType]) {
    bot.chat(`/msg ${username} Invalid kit type. Available kits: ${Object.keys(kitConfig).join(", ")}`);
    return;
  }

  // Add to queue
  requestQueue.push({ player: username, kit: kitType, timestamp: Date.now() });
  
  // Tell player their exact position in queue
  const position = requestQueue.length;
  if (position === 1 && !isProcessing) {
    bot.chat(`/msg ${username} Processing your ${kitType} kit request immediately!`);
  } else {
    bot.chat(`/msg ${username} Kit request received! You are number ${position} in queue. Please wait.`);
  }
  
  logMessageToFile(`New kit request from ${username} for ${kitType} kit (position ${position} in queue)`);
}

function handleError(err) {
  console.error(`Bot error: ${err}`);
  logMessageToFile(`Error: ${err}`);
  
  // Clear any pending kill timeout
  if (killTimeoutId) {
    clearTimeout(killTimeoutId);
    killTimeoutId = null;
    logMessageToFile('Canceled scheduled /kill command due to error');
  }
  
  bot.end();
}

function handleDisconnect() {
  console.log("Bot disconnected. Reconnecting in 5 seconds...");
  logMessageToFile("Bot disconnected. Reconnecting in 5 seconds...");
  
  // Clear any pending kill timeout
  if (killTimeoutId) {
    clearTimeout(killTimeoutId);
    killTimeoutId = null;
    logMessageToFile('Canceled scheduled /kill command due to disconnect');
  }
  
  bot.removeAllListeners();
  setTimeout(createBot, 5000);
}

async function checkQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  const request = requestQueue.shift();
  
  await processKitRequest(request.player, request.kit);
}

async function processKitRequest(player, kitType) {
  try {
    console.log(`Processing ${kitType} kit for ${player}`);
    logMessageToFile(`Processing ${kitType} kit for ${player}`);
    
    const kit = kitConfig[kitType];
    if (!kit) {
      bot.chat(`/msg ${player} Invalid kit type.`);
      isProcessing = false;
      return;
    }

    bot.chat(`/msg ${player} Processing your ${kitType} kit request...`);

    // Navigate to button location
    const coords = new Vec3(kit.coords.x, kit.coords.y, kit.coords.z);
    const goal = new goals.GoalNear(coords.x, coords.y, coords.z, 2);
    
    try {
      await bot.pathfinder.goto(goal);
    } catch (pathError) {
      throw new Error(`Pathfinding failed: ${pathError.message}`);
    }

    // Find and press button
    await pressButtonAndWait(player, kitType);

  } catch (err) {
    console.error(`Error processing kit request: ${err}`);
    logMessageToFile(`Error processing kit request for ${player}: ${err}`);
    bot.chat(`/msg ${player} Sorry, there was an error with your kit request: ${err.message}`);
    
    // Clear any pending kill timeout
    if (killTimeoutId) {
      clearTimeout(killTimeoutId);
      killTimeoutId = null;
      logMessageToFile('Canceled scheduled /kill command due to error in kit processing');
    }
    
    isProcessing = false;
  }
}

async function findButton() {
  // Look for any button type
  return bot.findBlock({
    matching: block => {
      return block.name.includes('button');
    },
    maxDistance: 3
  });
}

async function pressButtonAndWait(player, kitType) {
  try {
    // Find a button nearby
    const button = await findButton();
    if (!button) {
      throw new Error("No button found nearby");
    }

    logMessageToFile(`Found button at position: ${JSON.stringify(button.position)}`);
    
    // Look at the button
    await bot.lookAt(button.position);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Press the button (right-click interaction)
    await bot.activateBlock(button);
    logMessageToFile("Button pressed");
    
    // Wait fixed time
    bot.chat(`/msg ${player} Button pressed. Waiting for kit...`);
    await new Promise(resolve => setTimeout(resolve, BUTTON_WAIT_TIME));
    
    // Send teleport request to player
    bot.chat(`/tpa ${player}`);
    bot.chat(`/msg ${player} Got your ${kitType} kit! Teleporting to you...`);
    logMessageToFile(`Sent teleport request to ${player} for ${kitType} kit delivery`);
    
    // Schedule /kill command 60 seconds after teleport request
    // Store the timeout ID so we can cancel it if needed
    killTimeoutId = setTimeout(() => {
      logMessageToFile(`Executing /kill command after 60 seconds`);
      bot.chat("/kill");
      killTimeoutId = null; // Reset timeout ID
      isProcessing = false; // Set processing to false after kill
    }, KILL_DELAY);
    
  } catch (err) {
    logMessageToFile(`Button interaction error: ${err.message}`);
    throw err;
  }
}

// Initialize terminal interface
setupTerminalInterface();

// Start the bot
createBot();
