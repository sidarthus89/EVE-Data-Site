import { Link } from 'react-router-dom';

export default function Home() {
    return (
        <section className="home">
            <h1>Available Tools</h1>
            <ul>
                <li><Link to="/market">Full Market(Quickbar function still in progess)</Link></li>
                {/* <li><Link to="/appraisal">Appraisal</Link></li> */}
            </ul>

            <h1>Known Issues (As of: 8/29/2025)</h1>
            <ul>
                <li>Link to item on market not working</li>
                <li>Appraisal page is blank</li>
                <li>Trade Route is currently not working</li>
            </ul>

            <h1>Planned Features</h1>
            <ul>
                <li>Ores & Mineral Sourcin and Profits</li>
            </ul>

        </section>


    );
}
