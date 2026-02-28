# Title Misspellings Analysis

Generated from backfill of 312 titles. To be used for prompt improvements.

## Definite Misspellings

| Wrong | Correct | Notes |
|-------|---------|-------|
| Grock | Grok | xAI's chatbot |
| 03 AI | o3 | OpenAI's o3 model |
| England Gambit | Englund Gambit | Named after Fritz Englund |
| Fisher Random | Fischer Random | Named after Bobby Fischer |
| Nerdski | Naroditsky | Daniel Naroditsky |
| Speech Chess | Speed Chess | Tournament name |
| Arjuneris | Arjun Erigaisi | Indian GM |
| Weii / Wayi | Wei Yi | Chinese GM |

## Transcript-Garbled Names

| Garbled | Correct | Notes |
|---------|---------|-------|
| Nobec Abdul Storv | Nodirbek Abdusattorov | Uzbek World Rapid Champion |
| Noirbbec Abdul Suttor | Nodirbek Abdusattorov | |
| Abdusov / Abusador | Abdusattorov | |
| Levoneronian | Levon Aronian | Armenian GM |
| Kukeshyamov | Gukesh Dommaraju | Indian World Champion |
| Gesh | Gukesh | |
| Pragna / Pragananda | Praggnanandhaa | Indian GM (double 'g', double 'a') |
| Pragnandh Ramshbabu | Praggnanandhaa Rameshbabu | |
| Sindarov / Sundarov / Suturov / Sutrorov | Javokhir Sindarov | Uzbek GM |
| Erdogmush / Erdogmas | Yagiz Kaan Erdogmus | Turkish prodigy |
| Ludichi | Lorenzo Lodici? | Needs verification |
| Shir0v | Shirov | Alexei Shirov (zero vs letter o) |

## NOT Misspellings (User Confirmed)

| Name | Notes |
|------|-------|
| Martian | The Martian Gambit - a real opening |
| Gukesh | Short for Gukesh Dommaraju |

## Inconsistent Spellings (Pick One)

| Variations | Preferred |
|------------|-----------|
| Deshmuk / Desmuk / Deshmukh | Deshmukh |
| Pot Champs / Pog Champs | Pog Champs |

## Encoding Issues

These appear as corrupted characters in the output:
- `Judith Polg�r` → `Judith Polgár`
- `Fr�desj�` → Needs investigation

## Prompt Additions Needed

Add to system prompt a "Common Corrections" section:

```
IMPORTANT - Correct these common transcript errors:
- "Grock" → "Grok" (xAI chatbot)
- "England Gambit" → "Englund Gambit" (chess opening)
- "Fisher Random" → "Fischer Random" (Bobby Fischer)
- "Nobec/Noirbbec Abdul" → "Nodirbek Abdusattorov"
- "Levoneronian" → "Levon Aronian"
- "Pragna/Pragananda" → "Praggnanandhaa"
- "Wayi/Weii" → "Wei Yi"
- "o3" not "03" (OpenAI model)
```
