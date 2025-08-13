import { Link } from 'react-router-dom';

export default function Home() {
    return (
        <section className="home">
            <h1>Available Tools</h1>
            <ul>
                <li><Link to="/market">Full Market(Quickbar function still in progess)</Link></li>
                <li><Link to="/appraisal">Appraisal</Link></li>
            </ul>

            <h1>Tools in Development</h1>
            <ul>
                <li>Ores</li>
                <li>Minerals</li>
                <li>Trade Route</li>
                <li>Heat Map</li>
            </ul>

        </section>


    );
}
