import Map, { NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

interface MapProps {
    initialViewState?: {
        longitude: number;
        latitude: number;
        zoom: number;
    };
    style?: React.CSSProperties;
    mapStyle?: string;
    children?: React.ReactNode;
}

const MapComponent = ({
    initialViewState = {
        longitude: -7.0926,
        latitude: 31.7917,
        zoom: 5
    },
    style,
    mapStyle = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    children
}: MapProps) => {
    return (
        <Map
            initialViewState={initialViewState}
            style={style}
            mapStyle={mapStyle}
            mapLib={import('maplibre-gl')}
        >
            <NavigationControl position="top-right" />
            {children}
        </Map>
    );
};

export default MapComponent;
