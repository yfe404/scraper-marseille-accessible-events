export interface Event {
    url: string;
    name: string | null;
    description?: string;
    startDate?: string;
    endDate?: string;
    venue?: string;
    address?: string;
    city?: string;
    postalCode?: string;
    latitude?: string;
    longitude?: string;
    images?: string[];
}
