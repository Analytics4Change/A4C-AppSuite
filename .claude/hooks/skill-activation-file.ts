#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join } from 'path';

interface HookInput {
    session_id: string;
    tool_name: string;
    tool_input: {
        file_path?: string;
    };
}

interface FileTriggers {
    pathPatterns?: string[];
    pathExclusions?: string[];
    contentPatterns?: string[];
}

interface SkillRule {
    type: 'guardrail' | 'domain';
    enforcement: 'block' | 'suggest' | 'warn';
    priority: 'critical' | 'high' | 'medium' | 'low';
    description?: string;
    fileTriggers?: FileTriggers;
}

interface SkillRules {
    version: string;
    skills: Record<string, SkillRule>;
}

interface MatchedSkill {
    name: string;
    matchType: 'path' | 'content';
    config: SkillRule;
    matchedPattern: string;
}

/**
 * Convert glob pattern to regex
 * Supports: *, **, ?, specific extensions
 */
function globToRegex(pattern: string): RegExp {
    // Escape special regex characters except *, ?, and /
    let regexStr = pattern
        .replace(/\./g, '\\.')
        .replace(/\+/g, '\\+')
        .replace(/\^/g, '\\^')
        .replace(/\$/g, '\\$')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}');

    // Replace glob patterns
    regexStr = regexStr
        .replace(/\*\*/g, '___DOUBLE_STAR___')  // Temporarily replace **
        .replace(/\*/g, '[^/]*')                // * matches anything except /
        .replace(/___DOUBLE_STAR___/g, '.*')    // ** matches anything including /
        .replace(/\?/g, '.');                   // ? matches single character

    return new RegExp(`^${regexStr}$`);
}

/**
 * Check if file path matches a glob pattern
 */
function matchesPattern(filePath: string, pattern: string, projectDir: string): boolean {
    // Make path relative to project directory
    let relativePath = filePath;
    if (filePath.startsWith(projectDir)) {
        relativePath = filePath.substring(projectDir.length + 1); // +1 to remove leading /
    }

    const regex = globToRegex(pattern);
    return regex.test(relativePath);
}

/**
 * Check if file matches content patterns (optional, reads file)
 */
function matchesContentPatterns(filePath: string, patterns: string[]): boolean {
    try {
        // Read first 100 lines of file for performance
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').slice(0, 100).join('\n');

        return patterns.some(pattern => {
            // Simple substring match
            if (lines.includes(pattern)) {
                return true;
            }

            // Try as regex if pattern contains regex chars
            if (/[.*+?^${}()|[\]\\]/.test(pattern)) {
                try {
                    const regex = new RegExp(pattern, 'i');
                    return regex.test(lines);
                } catch {
                    return false;
                }
            }

            return false;
        });
    } catch {
        return false;
    }
}

async function main() {
    try {
        // Read input from stdin
        const input = readFileSync(0, 'utf-8');
        const data: HookInput = JSON.parse(input);

        // Skip if not an edit tool or no file path
        const toolName = data.tool_name;
        const filePath = data.tool_input.file_path;

        if (!toolName || !['Edit', 'MultiEdit', 'Write'].includes(toolName)) {
            process.exit(0);
        }

        if (!filePath) {
            process.exit(0);
        }

        // Skip markdown files (documentation)
        if (/\.(md|markdown)$/i.test(filePath)) {
            process.exit(0);
        }

        // Load skill rules
        const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
        const rulesPath = join(projectDir, '.claude', 'skills', 'skill-rules.json');
        const rules: SkillRules = JSON.parse(readFileSync(rulesPath, 'utf-8'));

        const matchedSkills: MatchedSkill[] = [];

        // Check each skill for file trigger matches
        for (const [skillName, config] of Object.entries(rules.skills)) {
            const triggers = config.fileTriggers;
            if (!triggers) {
                continue;
            }

            // Check path exclusions first
            if (triggers.pathExclusions) {
                const isExcluded = triggers.pathExclusions.some(pattern =>
                    matchesPattern(filePath, pattern, projectDir)
                );
                if (isExcluded) {
                    continue;
                }
            }

            // Check path patterns
            if (triggers.pathPatterns) {
                const matchedPattern = triggers.pathPatterns.find(pattern =>
                    matchesPattern(filePath, pattern, projectDir)
                );

                if (matchedPattern) {
                    matchedSkills.push({
                        name: skillName,
                        matchType: 'path',
                        config,
                        matchedPattern
                    });
                    continue; // Found path match, no need to check content
                }
            }

            // Check content patterns (optional, more expensive)
            if (triggers.contentPatterns) {
                if (matchesContentPatterns(filePath, triggers.contentPatterns)) {
                    matchedSkills.push({
                        name: skillName,
                        matchType: 'content',
                        config,
                        matchedPattern: 'content-match'
                    });
                }
            }
        }

        // Generate output if matches found
        if (matchedSkills.length > 0) {
            let output = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
            output += '💡 SKILL SUGGESTION (File-Based)\n';
            output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

            // Extract filename for display
            const filename = filePath.split('/').pop() || filePath;
            output += `📝 You edited: ${filename}\n\n`;

            // Group by priority
            const critical = matchedSkills.filter(s => s.config.priority === 'critical');
            const high = matchedSkills.filter(s => s.config.priority === 'high');
            const medium = matchedSkills.filter(s => s.config.priority === 'medium');
            const low = matchedSkills.filter(s => s.config.priority === 'low');

            if (critical.length > 0) {
                output += '⚠️  CRITICAL SKILLS (REQUIRED):\n';
                critical.forEach(s => {
                    output += `   → ${s.name}\n`;
                    if (s.config.description) {
                        output += `     ${s.config.description}\n`;
                    }
                });
                output += '\n';
            }

            if (high.length > 0) {
                output += '📚 RECOMMENDED SKILLS:\n';
                high.forEach(s => {
                    output += `   → ${s.name}\n`;
                    if (s.config.description) {
                        output += `     ${s.config.description}\n`;
                    }
                });
                output += '\n';
            }

            if (medium.length > 0) {
                output += '💡 SUGGESTED SKILLS:\n';
                medium.forEach(s => {
                    output += `   → ${s.name}\n`;
                    if (s.config.description) {
                        output += `     ${s.config.description}\n`;
                    }
                });
                output += '\n';
            }

            if (low.length > 0) {
                output += '📌 OPTIONAL SKILLS:\n';
                low.forEach(s => {
                    output += `   → ${s.name}\n`;
                    if (s.config.description) {
                        output += `     ${s.config.description}\n`;
                    }
                });
                output += '\n';
            }

            output += 'Consider using the Skill tool to load relevant guidelines.\n';
            output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

            console.log(output);
        }

        process.exit(0);
    } catch (err) {
        console.error('Error in skill-activation-file hook:', err);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Uncaught error:', err);
    process.exit(1);
});
