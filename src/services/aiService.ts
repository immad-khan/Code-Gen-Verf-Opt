import { AIResultData, ApiSettings, AgentLog, GeneratedCodeFile } from '../types';

const SYSTEM_PROMPT = `You are MACI, an expert Python code generator. Your task is to generate a complete, production-ready Python project. Use FastAPI and SQLAlchemy if no specific framework is mentioned in the user's request.

RESPONSE FORMAT RULES (FOLLOW EXACTLY):
1. You MUST return ONLY a valid JSON object, NO OTHER TEXT AT ALL!
2. The JSON MUST follow this EXACT structure:
{
  "summary": "one-line description of what was built",
  "files": [
    {
      "name": "filename.py",
      "path": "relative/path/to/filename.py",
      "category": "router|service|model|schema|data|test|config|utils|other",
      "description": "plain english description of the file",
      "content": "full file content here"
    },
    {
      "name": "another_file.toml",
      "path": "another_file.toml",
      "category": "config",
      "description": "description",
      "content": "full content"
    }
  ]
}

3. "category" MUST be exactly one of: router, service, model, schema, data, test, config, utils, other
4. Include at least 4 files in the "files" array
5. Include realistic bugs in the generated code (missing type hints, f-string SQL, hardcoded configs, etc.) so the analyzer has things to find
6. MAKE SURE THE JSON IS VALID - no trailing commas, proper quotes, complete structure!
7. DO NOT wrap the JSON in markdown code blocks!
8. DO NOT add any extra text before or after the JSON!`;

function createEmptyResultData(prompt: string, modelUsed: string): AIResultData {
  return {
    prompt,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    modelUsed,
    executiveSummary: {
      overallRisk: 'LOW',
      totalFindings: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      topMustFixes: [],
      confidence: 'High',
      confidenceReason: 'Real code from LLM + 12-technique client-side analyzer.'
    },
    mergeGate: {
      verdict: 'APPROVED',
      reason: 'No critical/high findings found.',
      temperature: 0.2
    },
    metrics: {
      processingTimeMs: 0,
      tokenCount: 0,
      qualityScore: 0,
      coverageRate: 0,
      agentConsensus: 0,
      specAlignment: 0,
      linterWarnings: 0,
      securityVulnerabilitiesCount: 0
    },
    generatedCode: [],
    findings: [],
    techniqueMatrix: [],
    securityChecklist: [],
    verificationCoverage: [],
    dependencyTable: [],
    recommendedTests: {
      unitPytest: '',
      propertyBased: '',
      fuzz: '',
      mutationWeakSpots: [],
      mutationTargetScore: 0
    },
    recommendedCiCdYaml: '',
    strengthsObserved: [],
    reviewerNotes: [],
    agentLogs: [],
    radarMetrics: [],
    specComparison: []
  };
}

function findMatchingBracket(str: string, startIdx: number): number {
  let count = 1;
  for (let i = startIdx + 1; i < str.length; i++) {
    if (str[i] === '{') count++;
    else if (str[i] === '}') count--;
    if (count === 0) return i;
  }
  return str.length - 1;
}

function fixTruncatedJson(text: string): string {
  // Try to fix truncated JSON by adding missing closing brackets/quotes
  let fixed = text.trim();
  
  // If the text ends inside a string (has an unclosed quote), close it
  let inString = false;
  let escapeNext = false;
  for (const char of fixed) {
    if (escapeNext) {
      escapeNext = false;
    } else if (char === '\\') {
      escapeNext = true;
    } else if (char === '"') {
      inString = !inString;
    }
  }
  if (inString) {
    fixed += '"';
  }

  // Count unclosed brackets and add closing ones
  let openBraces = 0;
  let openBrackets = 0;
  inString = false;
  escapeNext = false;
  for (const char of fixed) {
    if (escapeNext) {
      escapeNext = false;
    } else if (char === '\\') {
      escapeNext = true;
    } else if (char === '"') {
      inString = !inString;
    } else if (!inString) {
      if (char === '{') openBraces++;
      else if (char === '}') openBraces--;
      else if (char === '[') openBrackets++;
      else if (char === ']') openBrackets--;
    }
  }

  // Now, let's try to close arrays/objects properly
  // If we have an open array or object at the end, let's close them
  let temp = fixed;
  // Remove trailing commas first
  temp = temp.replace(/,(\s*[}\]])/g, '$1');
  // Now add closing brackets
  while (openBraces > 0 || openBrackets > 0) {
    if (openBrackets > 0) {
      temp += ']';
      openBrackets--;
    }
    if (openBraces > 0) {
      temp += '}';
      openBraces--;
    }
  }
  return temp;
}

function extractJson(text: string): any {
  console.log('=== extractJson received text ===');
  console.log(text);

  // Step 1: Clean up any prefixes
  let processedText = text.replace(/^(Groq|OpenAI|Anthropic|Gemini)\s+\d+:\s*/, '');

  // Step 2: Fix triple quotes (they mess up JSON!)
  processedText = processedText.replace(/"content"\s*:\s*"""([\s\S]*?)"""/g, (match, content) => {
    // Escape special JSON characters in the content
    const escapedContent = content
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"content": "${escapedContent}"`;
  });

  // Step 3: Find the main JSON object
  const tryParseJson = (jsonStr: string): any => {
    try {
      const firstBracket = jsonStr.indexOf('{');
      if (firstBracket === -1) return null;
      
      // Find matching bracket, then clean up any extra characters after it
      const matchingBracket = findMatchingBracket(jsonStr, firstBracket);
      let substring = jsonStr.substring(firstBracket, matchingBracket + 1);
      
      // Try parsing directly first
      let parsed = JSON.parse(substring);
      if (parsed && parsed.files) {
        return parsed;
      }
      
      // If not, try cleaning up trailing commas/extra braces
      let fixed = substring.replace(/,(\s*[}\]])/g, '$1');
      try {
        parsed = JSON.parse(fixed);
        if (parsed && parsed.files) return parsed;
      } catch {}

      // Try fixing truncated JSON
      fixed = fixTruncatedJson(substring);
      try {
        parsed = JSON.parse(fixed);
        if (parsed && parsed.files) return parsed;
      } catch {}
      
      return null;
    } catch {
      return null;
    }
  };

  let parsed = tryParseJson(processedText);
  if (parsed && parsed.files) return parsed;

  // Check for choices (OpenAI/Groq format)
  const outerParsed = tryParseJson(processedText);
  if (outerParsed) {
    if (outerParsed.choices?.[0]?.message?.content) {
      parsed = tryParseJson(outerParsed.choices[0].message.content);
      if (parsed && parsed.files) return parsed;
    }
    if (outerParsed.error?.failed_generation) {
      parsed = tryParseJson(outerParsed.error.failed_generation);
      if (parsed && parsed.files) return parsed;
    }
  }

  return null;
}

function normalizeFiles(parsed: any): GeneratedCodeFile[] {
  const files: GeneratedCodeFile[] = [];
  if (!parsed || !parsed.files || !Array.isArray(parsed.files)) return files;

  const validCategories = ['router', 'service', 'model', 'schema', 'data', 'test', 'config', 'utils', 'other'];
  let index = 0;
  for (const file of parsed.files) {
    if (!file) continue;
    const name = file.name ?? `file_${index + 1}.py`;
    const path = file.path ?? name;
    let category: string = 'other';
    if (file.category && validCategories.includes(file.category)) {
      category = file.category;
    }
    files.push({
      name,
      path,
      language: name.endsWith('.toml') || path.endsWith('.toml') ? 'toml' : 'python',
      category: category as any,
      description: file.description ?? 'Generated file',
      content: file.content ?? ''
    });
    index++;
  }
  return files;
}

async function callOpenAI(prompt: string, apiKey: string, model: string, temperature: number): Promise<string> {
  const requestBody = {
    model,
    temperature,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ]
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content ?? '';
}

async function callGroq(prompt: string, apiKey: string, model: string, temperature: number): Promise<string> {
  const requestBody = {
    model,
    temperature,
    max_tokens: 4096, // Lower max tokens to stay under rate limits
    response_format: { type: "json_object" }, // Enforce JSON response
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ]
  };

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const responseText = await response.text();
  let data;
  
  try {
    data = JSON.parse(responseText);
  } catch {
    data = null;
  }
  
  if (!response.ok && data?.error?.failed_generation) {
    // If there's a failed_generation field, return it for our extractJson function to parse
    return data.error.failed_generation;
  } else if (!response.ok) {
    throw new Error(`Groq error: ${response.status} - ${responseText}`);
  }

  return data?.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(prompt: string, apiKey: string, model: string, temperature: number): Promise<string> {
  const requestBody = {
    model,
    temperature,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }]
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.content[0].text ?? '';
}

async function callGemini(prompt: string, apiKey: string, model: string, temperature: number): Promise<string> {
  const requestBody = {
    generationConfig: { temperature, responseMimeType: 'application/json', maxOutputTokens: 4096 },
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }]
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text ?? '';
}

async function callProvider(prompt: string, apiSettings: ApiSettings, temperature: number): Promise<string> {
  switch (apiSettings.provider.toLowerCase()) {
    case 'openai':
      return await callOpenAI(prompt, apiSettings.apiKey, apiSettings.model, temperature);
    case 'groq':
      return await callGroq(prompt, apiSettings.apiKey, apiSettings.model, temperature);
    case 'anthropic':
      return await callAnthropic(prompt, apiSettings.apiKey, apiSettings.model, temperature);
    case 'gemini':
      return await callGemini(prompt, apiSettings.apiKey, apiSettings.model, temperature);
    default:
      throw new Error('Invalid provider');
  }
}

// Helper to get all available provider configs in priority order
function getProviderConfigs(): ApiSettings[] {
  const providers: ApiSettings[] = [];

  // Priority 1: Groq Key 1
  const groqKey1 = import.meta.env.VITE_GROQ_API_KEY;
  if (groqKey1 && groqKey1.trim().length > 8) {
    providers.push({
      provider: 'groq',
      apiKey: groqKey1,
      model: 'llama-3.1-8b-instant'
    });
  }

  // Priority 2: Groq Key 2
  const groqKey2 = import.meta.env.VITE_GROQ_API_KEY_2;
  if (groqKey2 && groqKey2.trim().length > 8) {
    providers.push({
      provider: 'groq',
      apiKey: groqKey2,
      model: 'llama-3.1-8b-instant'
    });
  }

  // Priority 3: Anthropic
  const anthropicKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (anthropicKey && anthropicKey.trim().length > 8) {
    providers.push({
      provider: 'anthropic',
      apiKey: anthropicKey,
      model: 'claude-3-5-sonnet-latest'
    });
  }

  // Priority 4: OpenAI
  const openaiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (openaiKey && openaiKey.trim().length > 8) {
    providers.push({
      provider: 'openai',
      apiKey: openaiKey,
      model: 'gpt-4o-mini'
    });
  }

  // Priority 5: Gemini
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (geminiKey && geminiKey.trim().length > 8) {
    providers.push({
      provider: 'gemini',
      apiKey: geminiKey,
      model: 'gemini-1.5-flash'
    });
  }

  return providers;
}

export async function processPromptWithAgents(
  prompt: string,
  apiSettings: ApiSettings,
  onProgress?: (p: number, log: AgentLog) => void
): Promise<AIResultData> {
  const ts = () => new Date().toLocaleTimeString();

  // Get all available providers (including the current one first)
  const allProviders = getProviderConfigs();
  
  // Start with the user's selected provider, or the first available if none
  let providersToTry = [...allProviders];
  // If the current apiSettings is not in the list, add it first
  const currentProviderExists = providersToTry.some(
    p => p.provider === apiSettings.provider && p.apiKey === apiSettings.apiKey
  );
  if (!currentProviderExists) {
    providersToTry.unshift(apiSettings);
  }

  // Try each provider in order
  for (let i = 0; i < providersToTry.length; i++) {
    const config = providersToTry[i];
    try {
      if (i > 0 && onProgress) {
        onProgress(15 + i * 5, {
          agentName: 'Gateway',
          role: 'Fallback',
          status: 'active',
          message: `Trying ${config.provider.toUpperCase()}...`,
          timestamp: ts(),
        });
      }

      if (onProgress) {
        onProgress(40, {
          agentName: 'Python Codegen',
          role: 'Generation',
          status: 'active',
          message: `Generating code with ${config.provider.toUpperCase()}...`,
          timestamp: ts(),
        });
      }

      const rawResponse = await callProvider(prompt, config, 0.6);
      console.log(`=== RAW LLM RESPONSE (${config.provider}) ===`);
      console.log(rawResponse);

      if (onProgress) {
        onProgress(85, {
          agentName: 'Parser',
          role: 'File extraction',
          status: 'active',
          message: 'Parsing files...',
          timestamp: ts(),
        });
      }

      const parsed = extractJson(rawResponse);
      console.log('=== PARSED JSON ===');
      console.log(parsed);

      const files = normalizeFiles(parsed);
      console.log('=== NORMALIZED FILES ===');
      console.log(files);

      if (files.length === 0) {
        throw new Error(`Could not parse valid files from ${config.provider}'s response.`);
      }

      if (onProgress) {
        onProgress(100, {
          agentName: 'Pipeline',
          role: 'Complete',
          status: 'completed',
          message: `Received ${files.length} Python files with ${config.provider.toUpperCase()}. Running 12-technique analyzer next...`,
          timestamp: ts(),
        });
      }

      const base = createEmptyResultData(prompt, `${config.provider.toUpperCase()} · ${config.model}`);
      return {
        ...base,
        generatedCode: files
      };
    } catch (err: any) {
      console.warn(`Failed with ${config.provider}: ${err.message}`);
      // If this is the last provider, rethrow the error
      if (i === providersToTry.length - 1) {
        let message = `Failed with all providers. Last error (${config.provider}): ${err.message}`;
        if (message.toLowerCase().includes('rate') || message.toLowerCase().includes('limit') || message.toLowerCase().includes('413')) {
          message = "Rate limits exceeded for all providers! Please try again in a minute.";
        }
        throw new Error(message);
      }
    }
  }

  throw new Error("No API keys configured! Please add at least one API key in the settings.");
}
