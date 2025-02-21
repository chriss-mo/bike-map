// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiY3MtbW8iLCJhIjoiY203ZWRiYWtzMGRwcTJqbzR3emdjajZkcSJ9.dWLdOuRijgHLqQMD6YLtuw';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18 // Maximum allowed zoom
});

const svg = d3.select('#map').select('svg');
let stations = [];
let trips = []; // Define trips variable

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

map.on('load', () => { 
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
    });
    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: {
          'line-color': 'green',
          'line-width': 3,
          'line-opacity': 0.4
        }
    });
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
    d3.json(jsonurl).then(jsonData => {
        stations = jsonData.data.stations;
        const csvurl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv'
        d3.csv(csvurl).then(csvData => {
            trips = csvData.map(trip => {
                trip.started_at = new Date(trip.started_at);
                trip.ended_at = new Date(trip.ended_at);
                let startedMinutes = minutesSinceMidnight(trip.started_at);
                let endedMinutes = minutesSinceMidnight(trip.ended_at);
                departuresByMinute[startedMinutes].push(trip);
                arrivalsByMinute[endedMinutes].push(trip);
                return trip;
            });
            filterTripsByTime(); // Filter trips after they are loaded
            updateData();
            timeSlider.addEventListener('input', updateTimeDisplay); // Add event listener after trips are loaded
            updateTimeDisplay(); // Initialize the display after trips are loaded
        }).catch(error => {
            console.error('Error loading CSV:', error);  // Handle errors if CSV loading fails
        });
    }).catch(error => {
        console.error('Error loading JSON:', error);  // Handle errors if JSON loading fails
    });
});

function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);  // Convert lon/lat to Mapbox LngLat
    const { x, y } = map.project(point);  // Project to pixel coordinates
    return { cx: x, cy: y };  // Return as object for use in SVG attributes
}

let timeFilter = -1;
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);  // Set hours & minutes
    return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);  // Get slider value
  
    if (timeFilter === -1) {
      selectedTime.textContent = '';  // Clear time display
      anyTimeLabel.style.display = 'block';  // Show "(any time)"
    } else {
      selectedTime.textContent = formatTime(timeFilter);  // Display formatted time
      anyTimeLabel.style.display = 'none';  // Hide "(any time)"
    }
  
    filterTripsByTime();
    updateData();
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
    let minMinute = (minute - 60 + 1440) % 1440;
    let maxMinute = (minute + 60) % 1440;
  
    if (minMinute > maxMinute) {
      let beforeMidnight = tripsByMinute.slice(minMinute);
      let afterMidnight = tripsByMinute.slice(0, maxMinute);
      return beforeMidnight.concat(afterMidnight).flat();
    } else {
      return tripsByMinute.slice(minMinute, maxMinute).flat();
    }
}

function filterTripsByTime() {
    filteredDepartures = filterByMinute(departuresByMinute, timeFilter);
    filteredArrivals = filterByMinute(arrivalsByMinute, timeFilter);
}

function updateData() {
    const filteredArrivalsMap = d3.rollup(
        filteredArrivals,
        (v) => v.length,
        (d) => d.end_station_id,
    );
    const filteredDeparturesMap = d3.rollup(
        filteredDepartures,
        (v) => v.length,
        (d) => d.start_station_id,
    );
    const filteredStations = stations.map((station) => {
        let id = station.short_name;
        station = { ...station }; // Clone the station object
        station.departures = filteredDeparturesMap.get(id) ?? 0;
        station.arrivals = filteredArrivalsMap.get(id) ?? 0;
        station.totalTraffic = station.departures + station.arrivals;
        return station;
    });
    

    const radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(filteredStations, (d) => d.totalTraffic)])
        .range(timeFilter === -1 ? [0, 25] : [3, 30]);

    const circles = svg.selectAll('circle')
        .data(filteredStations, d => d.short_name)
        .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic))
        .each(function(d) {
            d3.select(this)
              .append('title')
              .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
        })
        ;

    circles.exit().remove();

    circles.enter()
        .append('circle')
        .merge(circles)
        .attr('r', d => radiusScale(d.totalTraffic)) // Radius of the circle
        .attr('fill', 'steelblue')  // Circle fill color
        .attr('stroke', 'white')    // Circle border color
        .attr('stroke-width', 1)    // Circle border thickness
        .attr('opacity', 0.6)      // Circle opacity
        .each(function(d) {
            d3.select(this)
              .select('title')
              .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
        })
        ;

    function updatePositions() {
        circles
        .attr('cx', d => getCoords(d).cx)  // Set the x-position using projected coordinates
        .attr('cy', d => getCoords(d).cy); // Set the y-position using projected coordinates
    }
    updatePositions();
    map.on('move', updatePositions);     // Update during map movement
    map.on('zoom', updatePositions);     // Update during zooming
    map.on('resize', updatePositions);   // Update on window resize
    map.on('moveend', updatePositions);  // Final adjustment after movement ends
}

timeSlider.addEventListener('input', updateTimeDisplay);
updateTimeDisplay();