import { GoogleGenAI, Type } from "@google/genai";
import { Task, Priority, TaskStatus, AIAnalysisResult } from "../types";

const apiKey = process.env.API_KEY || '';

// Initialize Gemini Client
const getClient = () => new GoogleGenAI({ apiKey });

export const parseTaskWithAI = async (input: string): Promise<Partial<Task>> => {
  const ai = getClient();
  // formatting date to be very clear for the LLM
  const now = new Date();
  const nowString = now.toLocaleString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false,
    timeZoneName: 'short' 
  });
  
  const systemInstruction = `
    You are the parser for Zenith.sys, a technical task management system.
    Your objective is to convert natural language input into a structured JSON task protocol.
    
    CURRENT SYSTEM TIME: ${nowString}

    ### 1. PRIORITY ASSIGNMENT ALGORITHM (Strict Order)
    
    **Step A: Check for Explicit Overrides**
    If the input contains specific keywords, assign priority immediately:
    - "${Priority.URGENT}": "urgent", "asap", "emergency", "critical", "right now", "immediately".
    - "${Priority.HIGH}": "high priority", "important", "major", "must do".
    - "${Priority.LOW}": "low priority", "whenever", "eventually", "minor", "backlog".
    
    **Step B: Time-Based Calculation (If no keywords found)**
    Calculate the difference between the Inferred Due Date and Current System Time:
    - Diff < 4 Hours: Assign "${Priority.URGENT}"
    - Diff < 24 Hours: Assign "${Priority.HIGH}"
    - Diff < 72 Hours (3 Days): Assign "${Priority.MEDIUM}"
    - Diff >= 3 Days: Assign "${Priority.LOW}"

    ### 2. SUBTASK GENERATION STRATEGY
    
    - **Explicit Listing**: Map user-provided lists directly to subtasks.
    
    - **Nested & Hierarchical Handling (Flattening Strategy)**:
      - The system requires a flat list of subtasks.
      - If the user input contains nested lists (e.g., "Phase 1: a, b. Phase 2: c"), FLATTEN them using descriptive prefixes.
      - Format: "[Parent Context] Child Action"
      - Example Input: "Groceries (Dairy: Milk, Cheese; Veg: Carrots)"
      - Example Output Subtasks: ["Dairy: Milk", "Dairy: Cheese", "Veg: Carrots"]
      
    - **Conditional & Logic Handling**:
      - If input contains "If X then Y", break it down into a verification step and an action step.
      - Example Input: "If it rains, bring umbrella"
      - Example Output Subtasks: ["Check weather forecast", "Pack umbrella if rain predicted"]

    - **Implicit Complexity**: 
      - If the user provides a high-level goal (e.g., "Plan trip to Japan", "Deploy website") WITHOUT listing steps, you MUST intelligently generate 3-5 logical, technical subtasks required to complete that goal.
    
    ### 3. DATE & TIME INFERENCE
    - Resolve relative terms ("tomorrow", "in 2 hours", "next Friday") relative to Current System Time.
    - If no specific time is mentioned, default to 24 hours from now.
    - Return dates in strict ISO 8601 format.

    ### 4. CONTENT STYLE
    - Title: Concise and command-like (e.g., "Execute Deployment" instead of "I need to deploy").
    - Description: Brief technical summary.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: input,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            dueDate: { type: Type.STRING, description: "ISO 8601 format date string" },
            priority: { type: Type.STRING, enum: [Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.URGENT] },
            subtasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING }
                }
              }
            }
          },
          required: ["title", "dueDate", "priority"]
        }
      }
    });

    if (response.text) {
      const parsed = JSON.parse(response.text);
      
      // Process subtasks to match application structure
      const subtasks = parsed.subtasks?.map((st: any) => ({
        id: crypto.randomUUID(),
        title: st.title,
        isCompleted: false
      })) || [];

      return {
        ...parsed,
        subtasks,
        status: TaskStatus.TODO, // Default status
        aiSuggested: true,
        alerted: false
      };
    }
    throw new Error("No response text from Gemini");
  } catch (error) {
    console.error("Error parsing task with AI:", error);
    throw error;
  }
};

export const analyzeScheduleWithAI = async (tasks: Task[]): Promise<AIAnalysisResult> => {
  const ai = getClient();
  const activeTasks = tasks.filter(t => t.status !== TaskStatus.DONE);
  
  if (activeTasks.length === 0) {
    return {
      summary: "System idle. No active protocols detected.",
      suggestions: ["Initiate new protocols", "Review archived data", "Optimize system resources"],
      mood: 'calm'
    };
  }

  const tasksJson = JSON.stringify(activeTasks.map(t => ({
    title: t.title,
    due: t.dueDate,
    priority: t.priority,
    subtasksCount: t.subtasks?.length || 0
  })));

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Here is the current task registry: ${tasksJson}`,
      config: {
        systemInstruction: "Analyze the user's workload as a technical system monitor. Provide a brief, clinical summary, 3 efficiency optimization protocols (suggestions), and determine the system load (mood: calm, busy, or overloaded). Use technical, archival language.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            suggestions: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            mood: { type: Type.STRING, enum: ['calm', 'busy', 'overloaded'] }
          },
          required: ["summary", "suggestions", "mood"]
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text) as AIAnalysisResult;
    }
    throw new Error("No analysis returned");
  } catch (error) {
    console.error("Error analyzing schedule:", error);
    return {
      summary: "Analysis subsystem offline.",
      suggestions: [],
      mood: 'busy'
    };
  }
};