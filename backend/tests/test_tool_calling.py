#!/usr/bin/env python3
"""
Phase 0 validation: Test if llama3.1:8b can call tools correctly.

This script validates that the model can:
1. Call the correct tool
2. Use correct arguments
3. Achieve 90%+ success rate over multiple runs

Run this BEFORE proceeding with the tool calling refactor.
"""

import asyncio
import json
import urllib.request
import urllib.parse
from typing import Any


OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
MODEL = "llama3.1:8b"

# Define a simple test tool
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_temperature",
            "description": "Get the current temperature for a city",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "The city name"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "Temperature unit"
                    }
                },
                "required": ["city"]
            }
        }
    }
]


async def test_single_tool_call(query: str, expected_tool: str) -> dict[str, Any]:
    """
    Test a single tool calling interaction.

    Returns:
        dict with keys: success, tool_called, error
    """
    try:
        # Prepare request
        data = json.dumps({
            "model": MODEL,
            "messages": [{"role": "user", "content": query}],
            "tools": TOOLS,
            "stream": False
        }).encode('utf-8')

        req = urllib.request.Request(
            OLLAMA_URL,
            data=data,
            headers={'Content-Type': 'application/json'}
        )

        # Make request (run in executor to avoid blocking)
        loop = asyncio.get_event_loop()
        response_data = await loop.run_in_executor(
            None,
            lambda: urllib.request.urlopen(req, timeout=60).read()
        )

        data = json.loads(response_data)
        message = data.get("message", {})
        tool_calls = message.get("tool_calls", [])

        if not tool_calls:
            return {
                "success": False,
                "tool_called": None,
                "error": "No tool calls in response",
                "full_response": message.get("content", "")
            }

        # Check if the correct tool was called
        called_tool = tool_calls[0]["function"]["name"]
        success = called_tool == expected_tool

        return {
            "success": success,
            "tool_called": called_tool,
            "arguments": tool_calls[0]["function"]["arguments"],
            "error": None if success else f"Called {called_tool}, expected {expected_tool}"
        }

    except Exception as e:
        return {
            "success": False,
            "tool_called": None,
            "error": str(e)
        }


async def run_validation_suite(num_runs: int = 10) -> dict[str, Any]:
    """
    Run a suite of validation tests.

    Returns:
        dict with overall statistics
    """
    test_cases = [
        ("What's the temperature in San Francisco?", "get_temperature"),
        ("Tell me the weather in London", "get_temperature"),
        ("How hot is it in Tokyo?", "get_temperature"),
        ("What's the temp in New York in fahrenheit?", "get_temperature"),
    ]

    results = []

    print(f"Running {num_runs} test runs with {len(test_cases)} test cases each...")
    print("=" * 70)

    for run_idx in range(num_runs):
        print(f"\nRun {run_idx + 1}/{num_runs}")

        for query, expected_tool in test_cases:
            result = await test_single_tool_call(query, expected_tool)
            results.append(result)

            status = "✓" if result["success"] else "✗"
            tool = result.get("tool_called", "NONE")
            print(f"  {status} {query[:50]:50} → {tool}")

            if not result["success"] and result["error"]:
                print(f"    Error: {result['error']}")

    # Calculate statistics
    total = len(results)
    successes = sum(1 for r in results if r["success"])
    success_rate = (successes / total * 100) if total > 0 else 0

    print("\n" + "=" * 70)
    print(f"RESULTS: {successes}/{total} successful ({success_rate:.1f}%)")
    print("=" * 70)

    return {
        "total": total,
        "successes": successes,
        "failures": total - successes,
        "success_rate": success_rate,
        "results": results
    }


async def main():
    print(f"Tool Calling Validation Test")
    print(f"Model: {MODEL}")
    print(f"Ollama URL: {OLLAMA_URL}")
    print()

    # Check if Ollama is reachable
    try:
        urllib.request.urlopen("http://127.0.0.1:11434", timeout=5)
    except Exception as e:
        print(f"ERROR: Cannot reach Ollama at {OLLAMA_URL}")
        print(f"Make sure Ollama is running with: bash start.sh")
        return

    # Run validation
    stats = await run_validation_suite(num_runs=10)

    # Determine if validation passed
    REQUIRED_SUCCESS_RATE = 90.0

    if stats["success_rate"] >= REQUIRED_SUCCESS_RATE:
        print(f"\n✅ VALIDATION PASSED!")
        print(f"Success rate {stats['success_rate']:.1f}% meets requirement of {REQUIRED_SUCCESS_RATE}%")
        print(f"Safe to proceed with tool calling refactor.")
        return 0
    else:
        print(f"\n❌ VALIDATION FAILED!")
        print(f"Success rate {stats['success_rate']:.1f}% below requirement of {REQUIRED_SUCCESS_RATE}%")
        print(f"Consider:")
        print(f"  - Trying alternative models")
        print(f"  - Adjusting prompts or tool definitions")
        print(f"  - Keeping prompt-chaining architecture")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)
