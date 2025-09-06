# EVE Data Site

This is my first real big coding project. I took a lot of inspiration from https://evemarketbrowser.com and https://market.fuzzwork.co.uk/

## Database Monitoring and Maintenance

The project includes comprehensive database monitoring and maintenance tools:

### Monitor Database Tool (`monitor-database.cjs`)

A command-line tool for monitoring and maintaining the EVE market database:

```bash
# Check database size (default)
node monitor-database.cjs

# Show detailed database status
node monitor-database.cjs --status

# Run smart cleanup (keeps popular items)
node monitor-database.cjs --cleanup

# Run cleanup to specific target size
node monitor-database.cjs --cleanup --target 5.0

# Update regions.json with all tradeable regions
node monitor-database.cjs --update-regions

# Update stations.json with NPC stations and player structures  
node monitor-database.cjs --update-stations

# Update both regions.json and stations.json
node monitor-database.cjs --update-all

# Clear database tables
node monitor-database.cjs --clear
node monitor-database.cjs --clear --table market_orders
```

### Data Management

The site maintains comprehensive trading data including regions and stations:

#### Region Management

The site maintains a list of all EVE regions that have stations or player structures for trading:

- **Manual Update**: `node monitor-database.cjs --update-regions`
- **Weekly Automated Update**: `node weekly-data-update.cjs --regions-only`

#### Station Management  

The site maintains a database of both NPC stations and discoverable player structures:

- **Manual Update**: `node monitor-database.cjs --update-stations`
- **Weekly Automated Update**: `node weekly-data-update.cjs --stations-only`

#### Complete Data Update

For comprehensive maintenance, update both regions and stations:

- **Manual Update**: `node monitor-database.cjs --update-all`
- **Weekly Automated Update**: `node weekly-data-update.cjs`
- **Windows Batch File**: `weekly-data-update.bat`

The update process:
1. **Regions**: Fetches all regions from EVE ESI API and checks for tradeable structures
2. **Stations**: Extracts NPC stations from locations.json and discovers player structures from market activity
3. Updates respective JSON files with comprehensive data
4. Creates backups of existing files before updating
5. Adds metadata including last update timestamp

#### Setting up Weekly Data Updates

For automatic weekly updates, you can:

**Windows (Task Scheduler)**:
1. Open Task Scheduler
2. Create Basic Task
3. Set to run weekly (e.g., Sunday 3:00 AM)
4. Set action to run: `C:\path\to\weekly-data-update.bat`

**Linux/macOS (Crontab)**:
```bash
# Add to crontab for weekly execution at 3:00 AM on Sundays
0 3 * * 0 /usr/bin/node /path/to/weekly-data-update.cjs
```

This ensures both the region list and station database stay current with any new regions, stations, or player structures added to EVE Online.