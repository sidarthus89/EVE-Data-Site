import { Link } from 'react-router-dom';

export default function Home() {
    // Provide a scrollable area sized between fixed nav (48px) and footer (32px)
    // Parent containers have overflow hidden, so we create an internal scroll context here.
    const scrollAreaStyle = {
        overflowY: 'auto',
        height: 'calc(100vh - 48px - 32px)',
        boxSizing: 'border-box',
        paddingRight: '8px'
    };
    return (
        <section className="home" style={scrollAreaStyle}>
            <h1>Full Market</h1>
            <p>
                This featue is just like the in game market feature, but with some perks. Like:
            </p>
            <ul>
                <li>The ability to serach all regions at once.</li>
                <li>Markt distribution charts (supply and demand).</li>
                <li>Average prciing for items.</li>
                <li>Outlifer filtering via Interquartile Ranges.</li>
                <li>You can click on a station locaiton and it will copy it to your clipload.</li>
                <li>Savable/Shareable Link to items.</li>
                <li>Add to quickbar from the item marekt view.</li>
                <li>PLEX ticker for universe wide market high, low and average.</li>
                <li>Sort and filter by Security Level, Region, NPC/Player locations.</li>
            </ul>

            <h1>Region to Region Trading</h1>
            <p>
                This has been my attempt at recreating EveTrade's setup. It allows you to set critera fr a trade route between two regions and helps you figure out the best trade combos to make to make a profit.
            </p>
            <ul>
                <li>Orders update every 10 minutes</li>
                <li>You can click to copy the item name, the From location and the To location.</li>
                <li>Trade Route is currently not working</li>
            </ul>

            <h1>Known Issues (As of: 8/29/2025)</h1>
            <ul>
                <li>I need to adjust some of the spacing and fit for the region to region trade page. You may need to pan to the right to get the last few bits of informaiton.</li>
                <li>Shareable ink to item on market not working</li>
                <li>Appraisal page is blank</li>
                <li>Player structure names might be incorrect or missing in areas.</li>
            </ul>

        </section>


    );
}
