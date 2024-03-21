import bodyParser from "body-parser";
import express from "express";
import axios from "axios"; // Import axios for making HTTP requests
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // Initialize NodeState
  let currentState: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: false,
    k: 0
  };

// Array to store received messages
interface ReceivedMessage {
  type: string;
  round: number;
  value: string; // Vous pouvez ajuster le type en fonction de ce que vous attendez pour la valeur
}

let receivedMessages: ReceivedMessage[] = [];


  // Function to broadcast message to all nodes except itself
  const broadcastMessage = async (message: string) => {
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        try {
          await axios.post(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            message
          });
        } catch (error) {
          console.error(`Error broadcasting message to node ${i}:`, error);
        }
      }
    }
  };


  const runBenOrAlgorithm = async () => {
    let v: Value | null = currentState.x; // Initialize v with the current value
    let r = 1;
  
    while (!currentState.decided) {
      // Send echo1 message to all nodes
      await broadcastMessage(`<echo1,${r},${v}>`);
  
      // Wait for f+1 echo1 messages
      const echo1Messages = await waitForMessages(`echo1`, r);
  
      // Check if all echo1 messages have the same value
      const allHaveSameValue = echo1Messages.every(msg => msg.valueOf() === v);
  
      // Send echo2 message to all nodes
      if (allHaveSameValue) {
        await broadcastMessage(`<echo2,${r},${v}>`);
      } else {
        await broadcastMessage(`<echo2,${r},bot>`);
      }
  
      // Wait for f+1 echo2 messages
      const echo2Messages = await waitForMessages(`echo2`, r);
  
      // Check if all echo2 messages have the same value
      const allHaveSameNonBotValue = echo2Messages.every(msg => msg.valueOf() !== "bot");
  
      // Decide based on the received echo2 messages
      if (allHaveSameNonBotValue) {
        const nonBotValues = echo2Messages.map(msg => msg.valueOf() as Value);
        const u = findMajorityValue(nonBotValues);
        if (u !== null) {
          decide(u);
        }
      } else {
        if (echo2Messages.every(msg => msg.valueOf() === "bot")) {
          v = Math.random() < 0.5 ? 0 : 1; // Choose a random value if all messages have bot
        } else {
          const nonBotValues = echo2Messages.filter(msg => msg.valueOf() !== "bot").map(msg => msg.valueOf() as Value);
          const u = findMajorityValue(nonBotValues);
          if (u !== null) {
            v = u;
          }
        }
      }
  
      r++; // Increment r for the next round
    }
  };
  

  

  
  // Helper function to wait for f+1 messages of a given type and round from non-faulty nodes
  const waitForMessages = async (type: string, round: number) => {
    while (true) {
      await delay(2000); // Adjust the delay as needed

      const messages = receivedMessages.filter(msg => msg.type === type && msg.round === round );

      if (messages.length >= F + 1) {
        return messages;
      }
    }
  };

  
  // Helper function to find the majority value in an array
  const findMajorityValue = (values: Value[]) => {
    const count: { [key: string]: number } = {};
    for (const value of values) {
      count[value] = (count[value] || 0) + 1;
    }
    let majorityValue: Value | null = null;
    let maxCount = 0;
    for (const key in count) {
      if (count[key] > maxCount) {
        majorityValue = key as Value;
        maxCount = count[key];
      }
    }
    return majorityValue;
  };
  
  // Helper function to decide on a value
  const decide = (u: Value) => {
    currentState.decided = true;
    currentState.x = u;
    currentState.k = 2 * F + 1; // Update k to indicate finality
    broadcastMessage(`<decide,${u}>`); // Send decision to all nodes
  };
  
  
  // Function to introduce delay
  const delay = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
  };

  






  // Route to receive messages from other nodes
  node.post("/message", (req, res) => {
    const { type, round, value } = req.body; // Assurez-vous que votre requête contient les propriétés type, round et value
    receivedMessages.push({ type, round, value });
    res.sendStatus(200);
  });

  // Route to start the consensus algorithm
  node.get("/start", async (req, res) => {
    if (!currentState.killed) {
      currentState.k = 0;
      currentState.x = initialValue;
      await broadcastMessage(initialValue.toString());
      await runBenOrAlgorithm();
    }
    res.sendStatus(200);
  });

  // Route to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    currentState.killed = true;
    res.sendStatus(200);
  });

  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // Route to get the current state of a node
  node.get("/getState", (req, res) => {
    res.status(200).json(currentState);
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}


