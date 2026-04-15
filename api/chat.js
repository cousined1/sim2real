// Simple AI chat API for SIM2Real
// Returns canned responses about simulation-to-real robotics topics

const TOPIC_RESPONSES = {
  default: "SIM2Real helps robotics teams close the gap between simulation and real-world deployment. Our platform takes errors from your running robots, maps them back to simulation scenarios, and generates improved training data — so your next deployment is better than the last. Want to see how it works in a warehouse or factory setting?",
  pricing: "SIM2Real starts at $499/month for teams of up to 5 robots in pilot. Enterprise plans cover production fleets with unlimited deployments, priority support, and custom integration. Want to talk to our sales team about a custom pilot?",
  simulator: "SIM2Real works alongside your existing simulator (Webots, Isaac Sim, Mujoco, Drake, Unity) — it doesn't replace it. We help you identify where sim-to-real gaps are costing you in real-world failures, and generate training data to close those gaps.",
  integration: "We support ROS/ROS2, Webots, Isaac Sim, Mujoco, and custom robotics stacks. Integration typically takes 1-2 days. Our team handles the telemetry pipeline; you keep your existing workflows. Want to schedule a technical demo?",
  demo: "Happy to schedule a technical demo! We can show SIM2Real working with a real warehouse or manufacturing pilot. Reach out at hello@sim2real.dev or book directly at sim2real.dev/contact.",
};

export async function handleChat(message) {
  const lower = message.toLowerCase();

  if (lower.match(/price|cost|budget|cheap|expense|plan/)) {
    return TOPIC_RESPONSES.pricing;
  }
  if (lower.match(/simulat|webot|isaac|mujoco|drake|unity|ros|ros2/)) {
    return TOPIC_RESPONSES.simulator;
  }
  if (lower.match(/integrat|connect|api|webhook|webots/)) {
    return TOPIC_RESPONSES.integration;
  }
  if (lower.match(/demo|talk|sales|contact|schedul|book/)) {
    return TOPIC_RESPONSES.demo;
  }
  return TOPIC_RESPONSES.default;
}

export async function handlePOST(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const response = await handleChat(message.slice(0, 500));

    return res.status(200).json({
      success: true,
      response,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('Chat API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}