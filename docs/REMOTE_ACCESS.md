# Remote Access Guide

Secure SSH and VNC access to the A4C development environment via Cloudflare tunnels with Zero Trust authentication.

## Overview

This guide provides secure remote access to the development environment through:
- **SSH access**: `access.firstovertheline.com` (port 22)
- **VNC access**: `vnc.firstovertheline.com:5901` (display :1)
- **Security**: Cloudflare Zero Trust with `a4c-developers` team authentication
- **No Impact**: Public application at `a4c.firstovertheline.com` remains unaffected

## Prerequisites

### For Administrators
- [ ] Cloudflare tunnel configured and running
- [ ] DNS records created for access subdomains
- [ ] Zero Trust team `a4c-developers` configured
- [ ] VNC server installed and running on host
- [ ] SSH server enabled and configured

### For Users
- [ ] Cloudflare Zero Trust team membership (`a4c-developers`)
- [ ] SSH client (built into macOS/Linux)
- [ ] VNC client (Screen Sharing app on macOS)

## Quick Start

### SSH Access
```bash
ssh access.firstovertheline.com
```
1. Browser opens for Zero Trust authentication
2. Authenticate with your authorized email + MFA
3. SSH session establishes to the development server

### VNC Access (macOS)
```bash
open vnc://vnc.firstovertheline.com:5901
```
**Alternative methods:**
- Finder: `Cmd+K` → Enter `vnc://vnc.firstovertheline.com:5901`
- Screen Sharing.app: Connect to Server → `vnc.firstovertheline.com:5901`

1. Browser opens for Zero Trust authentication
2. Authenticate with your authorized email + MFA
3. VNC password prompt appears
4. Desktop session connects

## Detailed Setup Instructions

### SSH Server Configuration (Administrator)

SSH should already be running on most Linux systems. Verify and configure:

```bash
# Check SSH status
sudo systemctl status ssh

# Start SSH if not running
sudo systemctl enable ssh
sudo systemctl start ssh

# Optional: Configure SSH for better security
sudo nano /etc/ssh/sshd_config
```

**Recommended SSH hardening:**
```
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication yes  # Initially, can disable after key setup
PubkeyAuthentication yes
X11Forwarding yes          # For GUI applications over SSH
ClientAliveInterval 60     # Keep connections alive
ClientAliveCountMax 3
```

### VNC Server Setup (Administrator)

Install and configure VNC server for remote desktop access:

```bash
# Install VNC server
sudo apt update
sudo apt install tightvncserver

# Start VNC server (first time setup)
vncserver :1

# This will prompt for VNC password (required for connections)
# Choose a secure password and remember it for client connections
```

**Configure VNC startup script:**
```bash
# Create startup script
nano ~/.vnc/xstartup
```

**Basic xstartup content:**
```bash
#!/bin/bash
xrdb $HOME/.Xresources
startxfce4 &  # or your preferred desktop environment
```

**Start VNC server with specific settings:**
```bash
# Start VNC server with custom geometry and depth
vncserver :1 -localhost -geometry 1920x1080 -depth 24

# Check VNC server status
vncserver -list

# Kill VNC server if needed
vncserver -kill :1
```

### DNS Configuration (Administrator)

Add DNS records in Cloudflare dashboard with detailed step-by-step instructions:

#### Step 1: Find Your Existing Tunnel Configuration

1. **Navigate to Cloudflare DNS Dashboard**
   - Log into Cloudflare Dashboard
   - Select your domain: `firstovertheline.com`
   - Click on the **"DNS"** tab in the left sidebar

2. **Locate the Existing `a4c` Record**
   - Look for the record with name `a4c` (represents `a4c.firstovertheline.com`)
   - Check the **"Type"** column to see if it's an A or CNAME record
   - Note the **"Content"** field - this is what you'll copy
   - **Orange cloud should be enabled** (shows "Proxied")

3. **Copy the Content from the `a4c` Record**
   - **If `a4c` is an A Record**: Copy the IP address (e.g., `172.64.x.x` or `104.21.x.x`)
   - **If `a4c` is a CNAME Record**: Copy the target domain (e.g., `firstovertheline.com`)
   - This same content will be used for both new records

#### Step 2: Create Access Subdomain Record

1. **Click "Add record" button** (blue button at top of DNS records table)

2. **Configure SSH Access Record (match your `a4c` record type):**

   **If your `a4c` is an A Record:**
   ```
   Type: A
   Name: access
   IPv4 address: [paste the IP from the a4c record]
   Proxy status: Proxied (orange cloud icon - should be enabled)
   TTL: Auto (default)
   ```

   **If your `a4c` is a CNAME Record:**
   ```
   Type: CNAME
   Name: access
   Target: [paste the target domain from the a4c record]
   Proxy status: Proxied (orange cloud icon - should be enabled)
   TTL: Auto (default)
   ```

3. **Verify Settings:**
   - Record will create: `access.firstovertheline.com`
   - Content matches your `a4c` record exactly
   - Orange cloud is enabled (showing "Proxied")

4. **Click "Save"

#### Step 3: Create VNC Subdomain Record

1. **Click "Add record" button** again

2. **Configure VNC Access Record (same type as `a4c` and `access`):**

   **If using A Records:**
   ```
   Type: A
   Name: vnc
   IPv4 address: [same IP as a4c and access records]
   Proxy status: Proxied (orange cloud icon - should be enabled)
   TTL: Auto (default)
   ```

   **If using CNAME Records:**
   ```
   Type: CNAME
   Name: vnc
   Target: [same target as a4c and access records]
   Proxy status: Proxied (orange cloud icon - should be enabled)
   TTL: Auto (default)
   ```

3. **Verify Settings:**
   - Record will create: `vnc.firstovertheline.com`
   - Content matches `a4c` and `access` records exactly
   - Orange cloud is enabled (showing "Proxied")

4. **Click "Save"

#### Step 4: Verify DNS Records

**Your DNS records should now look like one of these:**

**Option A - If Using A Records:**
```
Type  Name     Content          Proxy    TTL
A     a4c      172.64.x.x      Proxied  Auto    (existing)
A     access   172.64.x.x      Proxied  Auto    (new)
A     vnc      172.64.x.x      Proxied  Auto    (new)
```

**Option B - If Using CNAME Records:**
```
Type   Name     Content                  Proxy    TTL
CNAME  a4c      firstovertheline.com    Proxied  Auto    (existing)
CNAME  access   firstovertheline.com    Proxied  Auto    (new)
CNAME  vnc      firstovertheline.com    Proxied  Auto    (new)
```

**Important Notes:**
- All three records MUST have identical content (matching your `a4c` record)
- All three records MUST be "Proxied" (orange cloud enabled)
- DNS propagation typically takes 1-5 minutes
- **Note**: CNAME records show target domains, not IP addresses - this is normal and expected

#### Step 5: Test DNS Configuration

**Wait 2-3 minutes, then test DNS resolution:**

```bash
# Test new records resolve to Cloudflare IPs
dig access.firstovertheline.com +short
dig vnc.firstovertheline.com +short

# Should return Cloudflare proxy IPs (not your server IP)
# Both commands should return identical results
```

**Expected Output Example:**
```
172.64.98.19
172.64.99.19
```

**Test HTTP Connectivity:**
```bash
# Should return Cloudflare headers (not tunnel errors)
curl -I https://access.firstovertheline.com
curl -I https://vnc.firstovertheline.com

# Expected: HTTP 200 or Cloudflare Access authentication page
# NOT expected: 502 Bad Gateway or connection refused
```

#### Troubleshooting DNS Issues

**Records Not Resolving:**
- Check DNS propagation: `dig @1.1.1.1 access.firstovertheline.com`
- Verify IP matches existing `a4c` record exactly
- Ensure orange cloud (Proxy) is enabled on all records

**502 Bad Gateway Errors:**
- DNS is working, but tunnel configuration issue
- Check tunnel restart status: `sudo systemctl status cloudflared`
- Verify tunnel configuration syntax

**Wrong IP in Records:**
- Should be Cloudflare proxy IP (172.64.x.x), not your server IP
- Copy IP exactly from existing `a4c` record
- Contact Cloudflare support if unsure about tunnel IP

### Zero Trust Team Setup (Administrator)

Detailed step-by-step Zero Trust configuration for first-time and existing users:

#### Step 1: Access Zero Trust Dashboard

1. **Navigate to Cloudflare Dashboard**
   - Log into your Cloudflare account
   - From the main dashboard, locate your domain (`firstovertheline.com`)

2. **Access Zero Trust**
   - Look for **"Zero Trust"** in the left sidebar
   - Click on **"Zero Trust"** to enter the Zero Trust dashboard
   - **If this is your first time:** You'll see a setup wizard

#### Step 2: First-Time Zero Trust Setup (Skip if already configured)

**If you see "Get started with Cloudflare One" or similar onboarding:**

1. **Choose Plan**
   - Select **"Free"** plan (supports up to 50 users)
   - Click **"Get started"** or **"Continue"**

2. **Team Domain Setup**
   - You'll be prompted to create a team domain
   - **Team name:** Enter `a4c-developers`
   - This creates: `a4c-developers.cloudflareaccess.com`
   - Click **"Next"** or **"Continue"**

3. **Initial Authentication Method**
   - Select **"Email"** as primary authentication method
   - You can add additional methods later
   - Click **"Next"** or **"Save"**

4. **Skip Optional Features**
   - Skip Gateway setup (not needed for this implementation)
   - Skip device enrollment (can configure later)
   - Complete the onboarding wizard

#### Step 3: Configure Authentication Methods

1. **Navigate to Authentication Settings**
   - In Zero Trust dashboard, go to **Settings** → **Authentication**
   - You should see **"Login methods"** section

2. **Verify Email Authentication**
   - **"Email"** should be enabled and show a green checkmark
   - This allows one-time PIN authentication via email

3. **Enable Multi-Factor Authentication (Recommended)**
   - Click **"Add new"** in Login methods
   - Select **"TOTP (Time-based One-Time Password)"**
   - This enables authenticator apps like Google Authenticator
   - Click **"Save"**

4. **Optional: Add Social Login**
   - Click **"Add new"** for additional methods
   - Consider **"Google"** if team uses Google accounts
   - Configure according to your preferences

#### Step 4: Create and Manage Team Members

1. **Navigate to User Management**
   - Go to **Settings** → **Users** in Zero Trust dashboard
   - Click on **"Users"** tab if not already selected

2. **Add Team Members**
   - Click **"Add users"** button
   - **Method 1 - Individual emails:**
     ```
     Enter email addresses (one per line):
     admin@yourdomain.com
     developer1@yourdomain.com
     developer2@yourdomain.com
     ```
   - **Method 2 - Bulk upload:** Use CSV format if many users

3. **Send Invitations**
   - Click **"Send invitation"**
   - Each user receives an email invitation
   - **Important:** Users MUST accept invitations to gain access

4. **Verify User Status**
   - Users should show **"Invited"** status initially
   - Status changes to **"Active"** after they accept invitation
   - Monitor this to ensure all team members are activated

#### Step 5: Access Policy Configuration

**Policies should auto-create when tunnel restarts, but verify manually:**

1. **Navigate to Applications**
   - Go to **Access** → **Applications** in Zero Trust dashboard
   - Look for automatically created applications

2. **Verify Auto-Created Policies**
   
   **Should see two applications:**
   ```
   Application: access.firstovertheline.com
   Status: Active
   Policies: Allow a4c-developers team
   
   Application: vnc.firstovertheline.com  
   Status: Active
   Policies: Allow a4c-developers team
   ```

3. **If Policies Don't Exist - Manual Creation**

   **Create SSH Access Policy:**
   - Click **"Add an application"**
   - **Application type:** Self-hosted
   - **Application name:** `SSH Access`
   - **Session duration:** 8 hours (adjust as needed)
   - **Application domain:** `access.firstovertheline.com`
   - **Next** → **Add a policy**
   - **Policy name:** `Allow a4c-developers`
   - **Action:** Allow
   - **Configure rules:** Include → Emails belonging to → `a4c-developers.cloudflareaccess.com`
   - **Save policy** → **Save application**

   **Create VNC Access Policy:**
   - Repeat above process with:
   - **Application name:** `VNC Access`
   - **Application domain:** `vnc.firstovertheline.com`
   - Same policy configuration

#### Step 6: MFA Setup for Users (User Action Required)

**Instructions to provide to team members:**

1. **Accept Invitation**
   - Check email for Cloudflare Access invitation
   - Click **"Accept invitation"** in email
   - Complete initial login with email address

2. **Set Up MFA (If Enabled)**
   - Download authenticator app (Google Authenticator, Authy, etc.)
   - In Zero Trust dashboard, go to **My Profile** → **Authentication**
   - Click **"Add authenticator"**
   - Scan QR code with authenticator app
   - Enter verification code to confirm

3. **Test Access**
   - Try accessing: `https://access.firstovertheline.com`
   - Should redirect to authentication page
   - Complete email + MFA flow
   - Should see "You are authenticated" or similar success message

#### Step 7: Verify Team Configuration

**Final verification checklist:**

1. **Team Domain Active**
   - Team domain: `a4c-developers.cloudflareaccess.com` is active
   - Visible in Settings → General

2. **Authentication Methods Working**
   - Email authentication enabled
   - MFA enabled (if configured)
   - Test login at team domain

3. **Users Active**
   - All invited users show "Active" status
   - Users can successfully authenticate

4. **Applications Protected**
   - `access.firstovertheline.com` → Protected ✓
   - `vnc.firstovertheline.com` → Protected ✓
   - Both redirect to authentication when accessed

5. **Existing App Unaffected**
   - `a4c.firstovertheline.com` → Still public ✓
   - No authentication required for main application

#### Troubleshooting Zero Trust Setup

**"Zero Trust" not visible in dashboard:**
- Ensure you're on the correct Cloudflare account
- Check domain is active and properly configured
- Try refreshing browser or clearing cache

**Team creation fails:**
- Team name `a4c-developers` might be taken
- Try variations: `a4c-dev-team`, `firstovertheline-dev`
- Ensure name contains only letters, numbers, hyphens

**Policies not auto-creating:**
- Wait 5-10 minutes after tunnel restart
- Check tunnel logs: `journalctl -u cloudflared -f`
- Manually create policies using instructions above

**Users can't access applications:**
- Verify user accepted invitation (check Status in Users)
- Test authentication at team domain first
- Clear browser cookies and retry
- Check MFA clock synchronization

**Applications showing as unprotected:**
- Verify hostnames match exactly in tunnel config
- Check DNS records are properly configured
- Restart cloudflared service after any config changes

## Cloudflare Dashboard Walkthrough

This section provides a comprehensive guide to navigating the Cloudflare UI for DNS and Zero Trust configuration.

### Dashboard Navigation Overview

#### Main Cloudflare Dashboard
```
Cloudflare Dashboard Layout:
┌─────────────────────────────────────┐
│ [Cloudflare Logo] [Account Menu]    │
├─────────────────────────────────────┤
│ Websites                            │
│ ├─ firstovertheline.com            │  ← Select your domain
│ │  ├─ Analytics                     │
│ │  ├─ DNS                          │  ← DNS management
│ │  ├─ Speed                        │
│ │  ├─ Security                     │
│ │  ├─ Zero Trust                   │  ← Zero Trust access
│ │  └─ ...                         │
│ └─ Add site                        │
├─────────────────────────────────────┤
│ Zero Trust                          │  ← Direct Zero Trust access
│ ├─ Access                          │
│ ├─ Gateway                         │
│ └─ Settings                        │
└─────────────────────────────────────┘
```

### DNS Management Detailed Walkthrough

#### Accessing DNS Records
1. **From Main Dashboard:**
   - Click on domain: `firstovertheline.com`
   - Look for **"DNS"** tab (usually 2nd or 3rd in list)
   - Should show: `🌐 DNS` with subdomain count

2. **DNS Records Interface:**
   ```
   DNS Records Table:
   ┌─────────────────────────────────────────────────────────┐
   │ [Add record] [Import] [Export]                          │
   ├──────┬─────────┬─────────────┬─────────┬──────┬────────┤
   │ Type │ Name    │ Content     │ Proxy   │ TTL  │ Action │
   ├──────┼─────────┼─────────────┼─────────┼──────┼────────┤
   │ A    │ @       │ 172.64.x.x  │ 🟠 Prx  │ Auto │ Edit   │
   │ A    │ a4c     │ 172.64.x.x  │ 🟠 Prx  │ Auto │ Edit   │  ← Find this IP
   │ A    │ www     │ 172.64.x.x  │ 🟠 Prx  │ Auto │ Edit   │
   └──────┴─────────┴─────────────┴─────────┴──────┴────────┘
   ```

3. **Key Visual Elements:**
   - **🟠 Orange Cloud:** Proxied (CDN enabled)
   - **⚫ Gray Cloud:** DNS only (direct to origin)
   - **Green status:** Active records
   - **"Auto" TTL:** Automatic cache timing

#### Adding DNS Records Step-by-Step

1. **Click "Add record" Button:**
   - Blue button, top-left of records table
   - Opens record creation form

2. **Record Creation Form:**
   ```
   Add DNS Record Form:
   ┌─────────────────────────────────────┐
   │ Type: [A ▼]                         │  ← Keep as "A"
   │ Name: [_____________]               │  ← Enter "access" or "vnc"
   │ IPv4 address: [_____________]       │  ← Paste tunnel IP
   │ Proxy status: [🟠 Proxied ▼]       │  ← Keep as "Proxied"
   │ TTL: [Auto ▼]                       │  ← Keep as "Auto"
   │                                     │
   │ [Cancel] [Save]                     │
   └─────────────────────────────────────┘
   ```

3. **Important Form Fields:**
   - **Type:** Always select "A" for tunnel records
   - **Name:** Just the subdomain name (not full domain)
   - **IPv4 address:** Must match existing `a4c` record exactly
   - **Proxy status:** Must be "Proxied" (orange cloud)
   - **TTL:** "Auto" is recommended

### Zero Trust Dashboard Detailed Walkthrough

#### Accessing Zero Trust
1. **Method 1 - From Domain Dashboard:**
   - Select domain → **"Zero Trust"** tab
   - Shows Zero Trust settings for this domain

2. **Method 2 - Direct Access:**
   - From main Cloudflare dashboard sidebar
   - Click **"Zero Trust"** (global access)

#### Zero Trust Dashboard Layout
```
Zero Trust Dashboard:
┌─────────────────────────────────────────────────┐
│ Zero Trust | a4c-developers                      │  ← Team name
├─────────────────────────────────────────────────┤
│ Sidebar:                     │ Main Content:    │
│ ├─ My Profile               │                  │
│ ├─ Access                   │                  │
│ │  ├─ Applications          │  ← Policy mgmt   │
│ │  ├─ Groups                │                  │
│ │  └─ Policies              │                  │
│ ├─ Gateway                  │                  │
│ ├─ Settings                 │                  │
│ │  ├─ General               │                  │
│ │  ├─ Authentication        │  ← Login methods │
│ │  ├─ Users                 │  ← Team members │
│ │  └─ Audit Logs            │                  │
│ └─ Logs                     │                  │
└─────────────────────────────────────────────────┘
```

#### User Management Interface

1. **Navigate to Users:**
   - **Settings** → **Users** in Zero Trust dashboard
   - Shows current team member list

2. **User Management Table:**
   ```
   Users Interface:
   ┌─────────────────────────────────────────────────────┐
   │ [Add users] [Bulk import] [Export]                  │
   ├─────────────────┬──────────┬─────────┬─────────────┤
   │ Email           │ Status   │ Last    │ Actions     │
   │                 │          │ Login   │             │
   ├─────────────────┼──────────┼─────────┼─────────────┤
   │ admin@domain    │ Active   │ 2h ago  │ [Remove]    │
   │ dev@domain      │ Invited  │ Never   │ [Resend]    │
   │ user@domain     │ Pending  │ Never   │ [Revoke]    │
   └─────────────────┴──────────┴─────────┴─────────────┘
   ```

3. **User Status Meanings:**
   - **Invited:** Email sent, awaiting acceptance
   - **Active:** User accepted invitation and can access
   - **Pending:** System processing invitation
   - **Inactive:** User removed or access revoked

#### Application Management Interface

1. **Navigate to Applications:**
   - **Access** → **Applications** in Zero Trust dashboard
   - Shows protected applications and policies

2. **Applications Interface:**
   ```
   Applications Interface:
   ┌─────────────────────────────────────────────────────┐
   │ [Add an application] [Import] [Export]              │
   ├─────────────────┬──────────┬─────────┬─────────────┤
   │ Application     │ Domain   │ Policies│ Actions     │
   ├─────────────────┼──────────┼─────────┼─────────────┤
   │ SSH Access      │ access.  │ 1       │ [Edit]      │
   │                 │ first... │         │ [Delete]    │
   ├─────────────────┼──────────┼─────────┼─────────────┤
   │ VNC Access      │ vnc.     │ 1       │ [Edit]      │
   │                 │ first... │         │ [Delete]    │
   └─────────────────┴──────────┴─────────┴─────────────┘
   ```

#### Authentication Methods Configuration

1. **Navigate to Authentication:**
   - **Settings** → **Authentication**
   - Shows available login methods

2. **Authentication Interface:**
   ```
   Login Methods:
   ┌─────────────────────────────────────────────────────┐
   │ [Add new]                                           │
   ├─────────────────┬──────────┬─────────┬─────────────┤
   │ Method          │ Status   │ Users   │ Actions     │
   ├─────────────────┼──────────┼─────────┼─────────────┤
   │ Email           │ ✅ Active │ All     │ [Configure] │
   │ TOTP            │ ✅ Active │ Optional│ [Configure] │
   │ Google SSO      │ ⚫ Disabled│ None   │ [Enable]    │
   └─────────────────┴──────────┴─────────┴─────────────┘
   ```

### Common UI Navigation Tips

#### Finding Information Quickly

1. **Search Functionality:**
   - Use browser's Find (Ctrl+F/Cmd+F) to locate specific settings
   - Search for: "access", "authentication", "applications"

2. **Breadcrumb Navigation:**
   - Most Cloudflare pages show breadcrumbs at the top
   - Example: `Home > Zero Trust > Settings > Users`
   - Click any breadcrumb to navigate back

3. **Dashboard Shortcuts:**
   - Bookmark direct links to frequently used sections
   - Example: `https://dash.cloudflare.com/[account-id]/access/applications`

#### Visual Indicators Understanding

1. **Status Colors:**
   - **🟢 Green:** Active, working correctly
   - **🟡 Yellow:** Warning, attention needed
   - **🔴 Red:** Error, immediate action required
   - **⚫ Gray:** Disabled or inactive

2. **Proxy Status (DNS):**
   - **🟠 Orange Cloud:** Proxied through Cloudflare (correct for tunnels)
   - **⚫ Gray Cloud:** DNS only, direct to origin (wrong for tunnels)

3. **User Status:**
   - **Active:** Green badge, user can authenticate
   - **Invited:** Blue badge, awaiting user action
   - **Pending:** Yellow badge, system processing

#### Troubleshooting UI Issues

**Page Not Loading:**
- Check account permissions (may not have Zero Trust access)
- Try different browser or incognito mode
- Clear cache and cookies for cloudflare.com

**Settings Not Saving:**
- Ensure all required fields are filled
- Check for validation errors (usually red text)
- Verify internet connection stability

**Can't Find Zero Trust:**
- May need to enable Zero Trust for the first time
- Look for "Cloudflare One" or "Teams" in older accounts
- Contact Cloudflare support if consistently missing

**DNS Records Not Appearing:**
- Refresh the page (F5)
- Check you're viewing the correct domain
- Records may take 1-2 minutes to appear after creation

## Client Connection Guide

### SSH Client Setup

**macOS/Linux (Terminal):**
```bash
# Basic connection
ssh access.firstovertheline.com

# With specific user
ssh username@access.firstovertheline.com

# With X11 forwarding for GUI apps
ssh -X access.firstovertheline.com

# With local port forwarding
ssh -L 8080:localhost:8080 access.firstovertheline.com
```

**Windows (PowerShell/WSL):**
```powershell
# Using built-in SSH client (Windows 10+)
ssh access.firstovertheline.com

# Or use PuTTY, WSL, or Git Bash
```

### VNC Client Setup

**macOS (Screen Sharing):**
```bash
# Command line
open vnc://vnc.firstovertheline.com:5901

# Via Finder
# 1. Press Cmd+K
# 2. Enter: vnc://vnc.firstovertheline.com:5901
# 3. Click Connect

# Via Screen Sharing app
# 1. Open Screen Sharing.app
# 2. Enter: vnc.firstovertheline.com:5901
# 3. Click Connect
```

**Windows (VNC Viewer):**
1. Download VNC Viewer from RealVNC
2. Install and open VNC Viewer
3. Enter server: `vnc.firstovertheline.com:5901`
4. Connect and follow authentication prompts

**Linux (Various clients):**
```bash
# Using Remmina
remmina vnc://vnc.firstovertheline.com:5901

# Using TigerVNC
vncviewer vnc.firstovertheline.com:5901

# Using Vinagre
vinagre vnc://vnc.firstovertheline.com:5901
```

## Authentication Flow

### Zero Trust Authentication Process

1. **Initiate Connection**
   - SSH: `ssh access.firstovertheline.com`
   - VNC: Connect to `vnc.firstovertheline.com:5901`

2. **Browser Authentication**
   - Browser window opens automatically
   - Cloudflare Zero Trust login page appears
   - Enter your authorized email address

3. **Multi-Factor Authentication**
   - Complete MFA challenge (SMS, authenticator app, etc.)
   - Cloudflare verifies team membership (`a4c-developers`)

4. **Connection Establishment**
   - Authentication successful → Connection proceeds
   - Authentication failed → Connection blocked

5. **Session Management**
   - SSH: Standard SSH session with terminal access
   - VNC: Desktop session requiring VNC password

### Session Persistence

- **SSH**: Sessions persist until manually disconnected or timeout
- **VNC**: Desktop sessions can be left running and reconnected
- **Authentication**: Zero Trust tokens have configurable expiration

## Security Features

### Network Security
- **Zero Trust**: All connections require authentication
- **Team-based Access**: Only `a4c-developers` team members allowed
- **Encrypted Transport**: All traffic encrypted via Cloudflare tunnel
- **No Direct Exposure**: Services not directly accessible from internet

### Access Control
- **Email Verification**: Must use authorized email address
- **MFA Required**: Multi-factor authentication enforced
- **Audit Logging**: All access attempts logged in Cloudflare
- **Session Monitoring**: Active sessions visible in Zero Trust dashboard

### Network Isolation
- **Public App Unaffected**: `a4c.firstovertheline.com` remains public
- **Administrative Separation**: SSH/VNC access isolated from public services
- **No Router Changes**: Uses existing Cloudflare tunnel infrastructure

## Troubleshooting

### Common SSH Issues

**Connection Refused:**
```bash
# Check if SSH server is running
sudo systemctl status ssh

# Check tunnel configuration
sudo systemctl status cloudflared

# Verify DNS resolution
nslookup access.firstovertheline.com
```

**Authentication Failures:**
- Verify team membership in Cloudflare Zero Trust
- Check email address authorization
- Clear browser cookies and retry
- Contact administrator for team access

**Permission Denied:**
```bash
# Check user account exists
id username

# Verify SSH configuration
sudo sshd -T | grep -i permitrootlogin
```

### Common VNC Issues

**Connection Timeout:**
```bash
# Check VNC server status
vncserver -list

# Restart VNC server if needed
vncserver -kill :1
vncserver :1 -localhost -geometry 1920x1080 -depth 24
```

**Black Screen/Desktop Issues:**
```bash
# Check desktop environment
ps aux | grep -i xfce  # or your DE

# Review VNC logs
cat ~/.vnc/*.log

# Restart with different desktop
echo "startxfce4 &" > ~/.vnc/xstartup
vncserver -kill :1
vncserver :1
```

**VNC Password Issues:**
```bash
# Reset VNC password
vncpasswd

# Restart VNC server
vncserver -kill :1
vncserver :1
```

### Zero Trust Issues

**Browser Not Opening:**
- Try connecting from different device/browser
- Check if corporate firewall blocks Cloudflare Access
- Manual navigation: Visit `https://a4c-developers.cloudflareaccess.com`

**Team Access Denied:**
- Contact administrator to verify team membership
- Ensure correct email address is being used
- Check if invitation email was received and accepted

**MFA Problems:**
- Verify authenticator app is in sync
- Use backup codes if available
- Contact administrator to reset MFA

### Network Diagnostics

Comprehensive testing procedures to verify the complete setup:

#### DNS Resolution Testing

**Basic DNS Tests:**
```bash
# Test new subdomain resolution
dig access.firstovertheline.com +short
dig vnc.firstovertheline.com +short

# Should return Cloudflare proxy IPs (172.64.x.x or 104.21.x.x)
# Both should return identical IP addresses
```

**Expected DNS Output:**
```
$ dig access.firstovertheline.com +short
172.64.98.19
172.64.99.19

$ dig vnc.firstovertheline.com +short
172.64.98.19
172.64.99.19
```

**Comprehensive DNS Verification:**
```bash
# Test against multiple DNS servers
dig @1.1.1.1 access.firstovertheline.com +short    # Cloudflare DNS
dig @8.8.8.8 access.firstovertheline.com +short    # Google DNS
dig @208.67.222.222 vnc.firstovertheline.com +short # OpenDNS

# Check DNS propagation status
for server in 1.1.1.1 8.8.8.8 208.67.222.222; do
  echo "Testing $server:"
  dig @$server access.firstovertheline.com +short
done
```

**DNS Troubleshooting:**
```bash
# Check for CNAME conflicts
dig access.firstovertheline.com ANY

# Verify TTL values
dig access.firstovertheline.com +ttlid

# Test with trace for debugging
dig access.firstovertheline.com +trace
```

#### HTTP Connectivity Testing

**Test Access Authentication Pages:**
```bash
# Test SSH access endpoint (should get Cloudflare Access page)
curl -I https://access.firstovertheline.com

# Test VNC access endpoint
curl -I https://vnc.firstovertheline.com

# Verify public app still works (should get normal response)
curl -I https://a4c.firstovertheline.com
```

**Expected HTTP Responses:**

**For Protected Endpoints (access/vnc):**
```
HTTP/2 302 
date: [current-date]
content-type: text/html; charset=utf-8
location: https://a4c-developers.cloudflareaccess.com/cdn-cgi/access/login/[token]
cf-team: a4c-developers
cf-access-jwt-assertion: [jwt-token]
server: cloudflare
```

**For Public App (a4c):**
```
HTTP/2 200 
date: [current-date]
content-type: text/html
server: nginx/1.x.x
cf-ray: [ray-id]
```

**Advanced HTTP Testing:**
```bash
# Test with verbose output
curl -v https://access.firstovertheline.com 2>&1 | grep -E "(HTTP|location|cf-)"

# Test SSL certificate
openssl s_client -connect access.firstovertheline.com:443 -servername access.firstovertheline.com < /dev/null 2>&1 | grep -A5 "Certificate chain"

# Test redirect chain
curl -L -v https://access.firstovertheline.com 2>&1 | grep -E "(HTTP|Location)"
```

#### Tunnel Configuration Testing

**Verify Tunnel Status:**
```bash
# Check tunnel service status
sudo systemctl status cloudflared

# Get detailed tunnel information
cloudflared tunnel info a4c-k3s-tunnel

# List all tunnels (should show a4c-k3s-tunnel)
cloudflared tunnel list
```

**Expected Tunnel Output:**
```
$ cloudflared tunnel info a4c-k3s-tunnel
Tunnel ID: c9fbbb48-792d-4ba1-86b7-c7a141c1eea6
Created: [date]
Connections: 4/4 connected
Hostnames: access.firstovertheline.com, vnc.firstovertheline.com, a4c.firstovertheline.com, k8s.firstovertheline.com
```

**Configuration Verification:**
```bash
# Verify config syntax
cloudflared tunnel validate /home/lars/.cloudflared/config.yml

# Check config contents
cat /home/lars/.cloudflared/config.yml

# Verify credentials file exists
ls -la /home/lars/.cloudflared/c9fbbb48-792d-4ba1-86b7-c7a141c1eea6.json
```

**Live Tunnel Monitoring:**
```bash
# Monitor tunnel logs in real-time
journalctl -u cloudflared -f

# Check for specific errors
journalctl -u cloudflared --since "10 minutes ago" | grep -i error

# Monitor connection status
watch -n 5 'cloudflared tunnel info a4c-k3s-tunnel'
```

#### Zero Trust Authentication Testing

**Manual Authentication Test:**
```bash
# Test authentication redirect
curl -s -I https://access.firstovertheline.com | grep -i location

# Should return: location: https://a4c-developers.cloudflareaccess.com/...
```

**Team Configuration Verification:**
1. **Via Browser:**
   - Visit: `https://a4c-developers.cloudflareaccess.com`
   - Should show Cloudflare Access login page
   - Verify team name appears correctly

2. **Check Team Domain:**
   ```bash
   # Test team domain resolution
   dig a4c-developers.cloudflareaccess.com +short
   
   # Should resolve to Cloudflare IPs
   ```

**Policy Verification:**
```bash
# Test both protected endpoints
for endpoint in access vnc; do
  echo "Testing $endpoint.firstovertheline.com:"
  response=$(curl -s -I https://$endpoint.firstovertheline.com)
  if echo "$response" | grep -q "cf-team: a4c-developers"; then
    echo "✅ $endpoint endpoint properly protected"
  else
    echo "❌ $endpoint endpoint not protected"
    echo "$response"
  fi
done
```

#### End-to-End Authentication Flow Testing

**SSH Authentication Flow:**
```bash
# Initiate SSH connection (will trigger browser authentication)
ssh -o ConnectTimeout=10 access.firstovertheline.com echo "SSH test"

# Expected behavior:
# 1. Browser opens automatically
# 2. Cloudflare Access login page appears
# 3. After authentication, SSH command executes
# 4. Should see "SSH test" output
```

**VNC Authentication Flow:**
```bash
# Test VNC connection (macOS)
open vnc://vnc.firstovertheline.com:5901

# Expected behavior:
# 1. Browser opens for authentication
# 2. After auth, VNC client prompts for VNC password
# 3. Desktop session should connect
```

**Authentication Troubleshooting:**
```bash
# Check browser process for authentication
ps aux | grep -i browser

# Verify no authentication bypass
curl -H "CF-Access-Client-Id: test" https://access.firstovertheline.com

# Should still require authentication, not bypass
```

#### Performance and Load Testing

**Basic Performance Tests:**
```bash
# Test response times
time curl -s -o /dev/null https://access.firstovertheline.com
time curl -s -o /dev/null https://vnc.firstovertheline.com
time curl -s -o /dev/null https://a4c.firstovertheline.com

# Test multiple concurrent connections
for i in {1..5}; do
  curl -s -I https://access.firstovertheline.com &
done
wait
```

**Network Quality Testing:**
```bash
# Test from different locations (if available)
curl -H "CF-IPCountry: US" -I https://access.firstovertheline.com
curl -H "CF-IPCountry: EU" -I https://access.firstovertheline.com

# Monitor bandwidth usage during VNC session
iftop -i eth0  # Replace eth0 with your interface
```

#### Comprehensive Health Check Script

**Create a test script:**
```bash
#!/bin/bash
# Save as: ~/test-remote-access.sh

echo "🔍 Remote Access Health Check"
echo "============================="

# DNS Tests
echo "📍 Testing DNS Resolution..."
for domain in access vnc a4c; do
  ip=$(dig +short $domain.firstovertheline.com | head -1)
  if [[ -n "$ip" ]]; then
    echo "✅ $domain.firstovertheline.com → $ip"
  else
    echo "❌ $domain.firstovertheline.com failed to resolve"
  fi
done

# HTTP Tests  
echo "🌐 Testing HTTP Connectivity..."
for domain in access vnc; do
  status=$(curl -s -o /dev/null -w "%{http_code}" https://$domain.firstovertheline.com)
  if [[ "$status" == "302" ]]; then
    echo "✅ $domain.firstovertheline.com → Protected (302 redirect)"
  else
    echo "❌ $domain.firstovertheline.com → Unexpected status: $status"
  fi
done

# Public app test
status=$(curl -s -o /dev/null -w "%{http_code}" https://a4c.firstovertheline.com)
if [[ "$status" == "200" ]]; then
  echo "✅ a4c.firstovertheline.com → Public (200 OK)"
else
  echo "⚠️  a4c.firstovertheline.com → Status: $status"
fi

# Tunnel Status
echo "🚇 Testing Tunnel Status..."
if systemctl is-active --quiet cloudflared; then
  echo "✅ Cloudflared service running"
  connections=$(cloudflared tunnel info a4c-k3s-tunnel 2>/dev/null | grep -o '[0-9]/[0-9] connected' || echo "unknown")
  echo "📊 Tunnel connections: $connections"
else
  echo "❌ Cloudflared service not running"
fi

echo "============================="
echo "✅ Health check complete"
```

**Run the health check:**
```bash
chmod +x ~/test-remote-access.sh
~/test-remote-access.sh
```

This comprehensive testing suite ensures every component of the remote access system is working correctly.

## Performance Optimization

### SSH Performance
```bash
# Use compression for slow connections
ssh -C access.firstovertheline.com

# Multiplex connections
ssh -o ControlMaster=auto -o ControlPath=/tmp/%r@%h:%p access.firstovertheline.com
```

### VNC Performance
```bash
# Lower color depth for faster performance
vncserver :1 -depth 16

# Smaller geometry for bandwidth-limited connections
vncserver :1 -geometry 1366x768

# Enable compression (client-side)
vncviewer -AutoSelect=0 -FullColor=0 vnc.firstovertheline.com:5901
```

## Maintenance

### Regular Tasks

**VNC Server Maintenance:**
```bash
# Weekly restart for stability
vncserver -kill :1
vncserver :1 -localhost -geometry 1920x1080 -depth 24

# Monitor VNC logs for issues
tail -f ~/.vnc/*.log
```

**SSH Configuration:**
```bash
# Review SSH logs periodically
sudo journalctl -u ssh -f

# Update SSH server when available
sudo apt update && sudo apt upgrade openssh-server
```

**Zero Trust Management:**
- Review team membership quarterly
- Monitor access logs for suspicious activity
- Update MFA methods as needed
- Rotate authentication credentials annually

### Monitoring

**Active Sessions:**
```bash
# View SSH sessions
who
last

# View VNC sessions
vncserver -list
ps aux | grep vnc
```

**Resource Usage:**
```bash
# Monitor system resources during remote sessions
htop
iotop
```

## Advanced Configuration

### SSH Key Authentication

**Generate SSH key pair:**
```bash
# On client machine
ssh-keygen -t ed25519 -C "your-email@example.com"

# Copy public key to server
ssh-copy-id access.firstovertheline.com
```

**Disable password authentication:**
```bash
# On server (/etc/ssh/sshd_config)
PasswordAuthentication no
sudo systemctl restart ssh
```

### VNC Desktop Environment

**Configure specific desktop environment:**
```bash
# For XFCE
echo "startxfce4 &" > ~/.vnc/xstartup

# For GNOME
echo "gnome-session &" > ~/.vnc/xstartup

# For KDE
echo "startkde &" > ~/.vnc/xstartup

# Make executable
chmod +x ~/.vnc/xstartup
```

### Custom Port Configuration

**SSH on non-standard port:**
```bash
# Modify tunnel config to use different port
service: ssh://192.168.122.42:2222
```

**Multiple VNC displays:**
```bash
# Start additional VNC servers
vncserver :2 -geometry 1920x1080 -depth 24
vncserver :3 -geometry 1366x768 -depth 16

# Access via different ports
# :1 = port 5901
# :2 = port 5902
# :3 = port 5903
```

## Security Best Practices

### SSH Hardening
- Use SSH keys instead of passwords when possible
- Configure fail2ban to prevent brute force attacks
- Use non-standard SSH port if needed
- Enable SSH session logging

### VNC Security
- Always use VNC in localhost-only mode (`-localhost`)
- Use strong VNC passwords (8+ characters)
- Consider VNC over SSH for additional encryption
- Disable VNC when not needed

### Access Management
- Regularly review team membership
- Use short-lived authentication tokens
- Monitor access logs for anomalies
- Implement least-privilege access principles

---

## Support

For issues or questions:
1. Check this troubleshooting guide first
2. Review Cloudflare Zero Trust dashboard for access issues
3. Check system logs for technical issues
4. Contact team administrator for access requests

**Important**: Never share VNC passwords or SSH keys. All access should go through the official Zero Trust authentication flow.