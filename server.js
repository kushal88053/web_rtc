const express = require("express");
const fs = require("fs");
const https = require("https");
const socketio = require("socket.io");
const app = express();

// Use the 'public' directory to serve static files
app.use(express.static("public"));

// Read SSL certificate and key
const key = fs.readFileSync("cert.key");
const cert = fs.readFileSync("cert.crt");

// Create HTTPS server with SSL certificates
const Server = https.createServer({ key, cert }, app);

// Initialize Socket.IO with CORS configuration
const io = socketio(Server, {
  cors: {
    origin: "*", // Allow all origins or specify your domain
    methods: ["GET", "POST"], // Allow specific methods
    credentials: true, // Allow cookies to be sent with requests
  },
});

// Placeholder arrays for connected sockets and offers
const connectedSockets = [];
const offers = [];

// Handle connection events
io.on("connection", (socket) => {
  // console.log("Someone has connected");
  const userName = socket.handshake.auth.userName;
  const password = socket.handshake.auth.password;

  if (password !== "x") {
    socket.disconnect(true);
    return;
  }
  connectedSockets.push({
    socketId: socket.id,
    userName,
  });

  //a new client has joined. If there are any offers available,
  //emit them out
  if (offers.length) {
    socket.emit("availableOffers", offers);
  }

  socket.on("newOffer", (newOffer) => {
    offers.push({
      offererUserName: userName,
      offer: newOffer,
      offerIceCandidates: [],
      answererUserName: null,
      answer: null,
      answererIceCandidates: [],
    });
    // console.log(newOffer.sdp.slice(50))
    //send out to all connected sockets EXCEPT the caller
    socket.broadcast.emit("newOfferAwaiting", offers.slice(-1));
  });

  socket.on("newAnswer", (offerObj, ackFunction) => {
    console.log(offerObj);
    //emit this answer (offerObj) back to CLIENT1
    //in order to do that, we need CLIENT1's socketid
    const socketToAnswer = connectedSockets.find(
      (s) => s.userName === offerObj.offererUserName
    );
    if (!socketToAnswer) {
      console.log("No matching socket");
      return;
    }
    //we found the matching socket, so we can emit to it!
    const socketIdToAnswer = socketToAnswer.socketId;
    //we find the offer to update so we can emit it
    const offerToUpdate = offers.find(
      (o) => o.offererUserName === offerObj.offererUserName
    );
    if (!offerToUpdate) {
      console.log("No OfferToUpdate");
      return;
    }
    //send back to the answerer all the iceCandidates we have already collected
    ackFunction(offerToUpdate.offerIceCandidates);
    offerToUpdate.answer = offerObj.answer;
    offerToUpdate.answererUserName = userName;
    //socket has a .to() which allows emiting to a "room"
    //every socket has it's own room
    socket.to(socketIdToAnswer).emit("answerResponse", offerToUpdate);
  });

  socket.on("sendIceCandidateToSignalingServer", (iceCandidateObj) => {
    const { didIOffer, iceUserName, iceCandidate } = iceCandidateObj;
    // console.log(iceCandidate);
    if (didIOffer) {
      //this ice is coming from the offerer. Send to the answerer
      const offerInOffers = offers.find(
        (o) => o.offererUserName === iceUserName
      );
      if (offerInOffers) {
        offerInOffers.offerIceCandidates.push(iceCandidate);
        // 1. When the answerer answers, all existing ice candidates are sent
        // 2. Any candidates that come in after the offer has been answered, will be passed through
        if (offerInOffers.answererUserName) {
          //pass it through to the other socket
          const socketToSendTo = connectedSockets.find(
            (s) => s.userName === offerInOffers.answererUserName
          );
          if (socketToSendTo) {
            socket
              .to(socketToSendTo.socketId)
              .emit("receivedIceCandidateFromServer", iceCandidate);
          } else {
            console.log("Ice candidate recieved but could not find answere");
          }
        }
      }
    } else {
      //this ice is coming from the answerer. Send to the offerer
      //pass it through to the other socket
      const offerInOffers = offers.find(
        (o) => o.answererUserName === iceUserName
      );
      const socketToSendTo = connectedSockets.find(
        (s) => s.userName === offerInOffers.offererUserName
      );
      if (socketToSendTo) {
        socket
          .to(socketToSendTo.socketId)
          .emit("receivedIceCandidateFromServer", iceCandidate);
      } else {
        console.log("Ice candidate recieved but could not find offerer");
      }
    }
    // console.log(offers)
  });
});

// Start HTTPS server
const PORT = process.env.PORT || 3000;
Server.listen(PORT, () => {
  console.log(`Server is running on https://localhost:${PORT}`);
});
