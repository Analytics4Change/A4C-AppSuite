# Git-Crypt Setup Guide

## Overview

This repository uses **git-crypt** to securely store sensitive environment files (`.env.local`) directly in the repository. Files are transparently encrypted/decrypted during git operations.

## For New Team Members

To access the encrypted files in this repository, you need the git-crypt key.

### Step 1: Install git-crypt

**macOS:**
```bash
brew install git-crypt
```

**Ubuntu/Debian:**
```bash
sudo apt-get install git-crypt
```

**Windows:**
Download from [AGWA/git-crypt releases](https://github.com/AGWA/git-crypt/releases)

### Step 2: Get the Key

Request the `A4C-FrontEnd-git-crypt.key` file from your team lead or administrator.

**⚠️ IMPORTANT**: This key file should be shared securely (not via email or public channels). Use:
- Secure file transfer service
- Encrypted messaging
- In-person transfer
- Password-protected archive

### Step 3: Unlock the Repository

Once you have the key file:

```bash
# Clone the repository if you haven't already
git clone https://github.com/Analytics4Change/A4C-FrontEnd.git
cd A4C-FrontEnd

# Unlock the repository with the key
git-crypt unlock /path/to/A4C-FrontEnd-git-crypt.key
```

### Step 4: Verify

Check that `.env.local` is now readable:

```bash
# This should show the decrypted contents
cat .env.local

# Verify encryption status
git-crypt status
```

## Files Protected by git-crypt

The following files are automatically encrypted in the repository:

- `.env.local` - Local development environment variables
- `.env.production` - Production environment variables (if added)
- `.env.staging` - Staging environment variables (if added)
- `*.secret` - Any file ending with .secret
- `**/secrets/*` - Any file in a secrets directory

See `.gitattributes` for the full configuration.

## For Repository Administrators

### Adding New Team Members

1. **Option A: Share the existing key**
   ```bash
   # Export the key (if you don't have it)
   git-crypt export-key ../A4C-FrontEnd-git-crypt.key

   # Share this key securely with the new team member
   ```

2. **Option B: Use GPG keys (more secure)**
   ```bash
   # Add a user's GPG key
   git-crypt add-gpg-user USER_GPG_KEY_ID

   # The user can then unlock with their GPG key
   git-crypt unlock
   ```

### Adding New Files to Encryption

Edit `.gitattributes` and add patterns for new files:

```
# Example: Add all .env files
.env.* filter=git-crypt diff=git-crypt

# Example: Add specific file
config/secrets.json filter=git-crypt diff=git-crypt
```

### Rotating the Key (If Compromised)

```bash
# First, decrypt all files
git-crypt unlock

# Remove git-crypt
rm .git/git-crypt

# Re-initialize with new key
git-crypt init

# Re-add all files
git add .

# Commit
git commit -m "chore: Rotate git-crypt key"

# Export new key for team
git-crypt export-key ../A4C-FrontEnd-git-crypt-NEW.key
```

## How It Works

1. **Transparent Operation**: Files appear decrypted in your working directory but are encrypted in the repository
2. **Automatic**: Encryption/decryption happens automatically during git operations
3. **Secure**: Uses AES-256 encryption
4. **Selective**: Only specified files are encrypted (see `.gitattributes`)

## Troubleshooting

### "git-crypt: not initialized"

You need to unlock the repository:
```bash
git-crypt unlock /path/to/key
```

### Files appear as binary/encrypted

The repository isn't unlocked. Run:
```bash
git-crypt status
```

If files show as "encrypted", you need to unlock the repository.

### Can't unlock repository

1. Verify you have the correct key file
2. Check git-crypt is installed: `git-crypt --version`
3. Ensure you're in the repository root directory

### Modified encrypted files show large diffs

This is normal. Encrypted files will show as binary changes. Use:
```bash
git-crypt diff
```
to see the actual changes in decrypted form.

## Security Best Practices

1. **Never commit the key file** - Keep it separate from the repository
2. **Share keys securely** - Use encrypted channels
3. **Rotate keys periodically** - Especially when team members leave
4. **Backup the key** - Store securely in multiple locations
5. **Limit access** - Only share with team members who need it

## Important Notes

- The `.env.local` file is now tracked in git (encrypted)
- Changes to `.env.local` will appear in git diff (decrypted locally)
- The file is encrypted in the remote repository
- Only team members with the key can read the file
- CI/CD systems need the key to access encrypted files

## Getting Help

- git-crypt documentation: https://github.com/AGWA/git-crypt
- Team contact: [Your team lead or DevOps contact]