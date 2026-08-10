const EARTH_RADIUS_METERS = 6371e3;
const SCHOOL_RADIUS_METERS = 300;

const parseCoordinates = (latitude, longitude) => {
  if (latitude === null || latitude === undefined || String(latitude).trim() === ''
    || longitude === null || longitude === undefined || String(longitude).trim() === '') return null;
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)
    || parsedLatitude < -90 || parsedLatitude > 90
    || parsedLongitude < -180 || parsedLongitude > 180) return null;
  return { latitude: parsedLatitude, longitude: parsedLongitude };
};

const getDistanceInMeters = (lat1, lon1, lat2, lon2) => {
  const toRadians = (degrees) => degrees * (Math.PI / 180);
  const latitudeDelta = toRadians(lat2 - lat1);
  const longitudeDelta = toRadians(lon2 - lon1);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
    * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const isTrue = (value) => value === true || value === 1
  || (typeof value === 'string' && ['true', '1'].includes(value.trim().toLowerCase()));

module.exports = { SCHOOL_RADIUS_METERS, parseCoordinates, getDistanceInMeters, isTrue };
