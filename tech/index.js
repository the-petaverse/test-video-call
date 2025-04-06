const techSupportSocket = io("http://localhost:4200/tech-support", {
  query: { role: "attendant" },
});

let activeRoom = null;

// Handle incoming support messages and dynamically add to session list
techSupportSocket.on(
  "new-tech-support-message",
  ({ sessionId, userId, message, sender, timestamp }) => {
    //   console.log("🆕 New tech support message received", data);
    //   const { sessionId, userId, message, sender, timestamp } = data;
    const room = `${sessionId}-${userId}`;

    if (!document.getElementById(`room-${room}`)) {
      const sessionElem = document.createElement("button");
      sessionElem.id = `room-${room}`;
      sessionElem.innerHTML = `Session: ${sessionId}, User: ${userId}`;
      sessionElem.onclick = () => joinRoom(sessionId, userId);
      document.getElementById("sessionsList").appendChild(sessionElem);
    }

    // Automatically join room if no active room yet
    if (!activeRoom) joinRoom(sessionId, userId);

    if (activeRoom === room) appendMessage(sender, message, timestamp);
  }
);

// Function to join a specific room to reply
function joinRoom(sessionId, userId) {
  activeRoom = `${sessionId}-${userId}`;
  document.getElementById("chatMessages").innerHTML = "";

  techSupportSocket.emit("join-tech-room", {
    sessionId,
    userId,
    role: "attendant",
  });
}

// Append messages to chat UI
function appendMessage(sender, message, timestamp) {
  const chatMessages = document.getElementById("chatMessages");
  const msgElem = document.createElement("div");

  msgElem.innerHTML = `
    <div style="padding:5px; border-bottom:1px solid #ccc;">
      <strong>${sender}:</strong> ${message} 
      <small style="color:gray;">${new Date(
        timestamp
      ).toLocaleTimeString()}</small>
    </div>
  `;

  chatMessages.appendChild(msgElem);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Send reply message to user
document.getElementById("sendReply").addEventListener("click", () => {
  const replyInput = document.getElementById("replyInput");
  const message = replyInput.value.trim();
  if (!message || !activeRoom) return;

  const [sessionId, userId] = activeRoom.split("-");

  techSupportSocket.emit("tech-support-message", {
    sessionId,
    userId,
    sender: "attendant",
    message,
  });

  replyInput.value = "";
});
